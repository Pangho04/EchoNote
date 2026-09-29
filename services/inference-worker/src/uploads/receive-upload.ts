import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type UploadCompletionRequest, uploadCompletionRequestSchema } from '@echonote/contracts';

import { UploadCompletionError } from './upload-completion-error.js';
import type { UploadGrantClaims } from './upload-grant-verifier.js';

const INCOMING_DIR = '.incoming';
const FINAL_DIR = 'final';
const PROBE_PREFIX = '.probe-';

// 첫 box의 size(4 byte) 다음 offset 4에 type `ftyp`가 있어야 받는다.
const FTYP_MAGIC = Buffer.from('ftyp');
const MAGIC_END = 8;

export class UploadVerificationError extends Error {
  constructor() {
    super('upload verification failed');
  }
}

// 시작할 때 한 번 호출한다. 이전 실행이 남긴 temp를 지우고 hard link가 되는 볼륨인지 확인한다.
export const prepareUploadDirectories = async (dataDir: string) => {
  const incomingDir = join(dataDir, INCOMING_DIR);
  const finalDir = join(dataDir, FINAL_DIR);

  await mkdir(incomingDir, { recursive: true });
  await mkdir(finalDir, { recursive: true });

  const leftovers = [
    ...(await readdir(incomingDir)).map((name) => join(incomingDir, name)),
    ...(await readdir(finalDir))
      .filter((name) => name.startsWith(PROBE_PREFIX))
      .map((name) => join(finalDir, name)),
  ];

  await Promise.all(leftovers.map((path) => rm(path, { force: true, recursive: true })));

  const probeId = randomUUID();
  const probeSource = join(incomingDir, `probe-${probeId}`);
  const probeTarget = join(finalDir, `${PROBE_PREFIX}${probeId}`);

  try {
    await (await open(probeSource, 'wx')).close();
    await link(probeSource, probeTarget);
  } finally {
    await rm(probeSource, { force: true });
    await rm(probeTarget, { force: true });
  }
};

type LogTempCleanupFailure = (code: unknown) => void;

// JSON이 아니면 schema 검사에서 거르도록 undefined를 돌려준다. 원본 오류는 파일 조각을 담을 수 있다.
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// final/<jobId>.json에 완료 통지 command를 한 번만 쓴다. 이미 있으면 덮어쓰지 않고 같은 내용인지 확인한다.
const ensureCompletionManifest = async (
  dataDir: string,
  command: UploadCompletionRequest,
  logTempCleanupFailure: LogTempCleanupFailure,
) => {
  const tempPath = join(dataDir, INCOMING_DIR, randomUUID());
  const manifestPath = join(dataDir, FINAL_DIR, `${command.jobId}.json`);

  try {
    const handle = await open(tempPath, 'wx');

    try {
      await handle.writeFile(JSON.stringify(command));
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(tempPath, manifestPath);

      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    await rm(tempPath, { force: true }).catch((error: NodeJS.ErrnoException) =>
      logTempCleanupFailure(error.code),
    );
  }

  const existing = uploadCompletionRequestSchema.safeParse(
    parseJson(await readFile(manifestPath, 'utf8')),
  );

  if (!existing.success) throw new UploadCompletionError('manifest_invalid');

  const keys = Object.keys(command) as (keyof UploadCompletionRequest)[];

  if (!keys.every((key) => existing.data[key] === command[key])) {
    throw new UploadCompletionError('manifest_mismatch');
  }
};

type ReceiveUploadOptions = {
  body: Readable;
  claims: UploadGrantClaims;
  dataDir: string;
  logTempCleanupFailure: LogTempCleanupFailure;
};

// body를 temp에 받아 길이·SHA-256·magic을 확인한 뒤 final에 link하고 manifest를 남긴다.
// Gateway에 보낼 완료 통지 command를 돌려준다. temp는 항상 지운다.
export const receiveUpload = async ({
  body,
  claims,
  dataDir,
  logTempCleanupFailure,
}: ReceiveUploadOptions): Promise<UploadCompletionRequest> => {
  const tempPath = join(dataDir, INCOMING_DIR, randomUUID());

  try {
    const hash = createHash('sha256');
    let receivedBytes = 0;
    let head = Buffer.alloc(0);
    const handle = await open(tempPath, 'wx');

    await pipeline(
      body,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          receivedBytes += chunk.length;

          if (head.length < MAGIC_END) {
            head = Buffer.concat([head, chunk.subarray(0, MAGIC_END - head.length)]);
          }

          yield chunk;
        }
      },
      // flush는 close 전에 fsync한다. pipeline이 끝나면 autoClose로 handle도 닫힌다.
      handle.createWriteStream({ flush: true }),
    );

    if (
      receivedBytes !== claims.size_bytes ||
      hash.digest('hex') !== claims.sha256 ||
      !head.subarray(4, MAGIC_END).equals(FTYP_MAGIC)
    ) {
      throw new UploadVerificationError();
    }

    try {
      // rename은 Windows에서 기존 final을 덮어쓴다. link는 기존 파일이 있으면 EEXIST로 실패한다.
      await link(tempPath, join(dataDir, FINAL_DIR, `${claims.job_id}.m4a`));
    } catch (error) {
      // 같은 job의 grant는 같은 sha256을 담으므로 이미 있는 final은 같은 내용이다.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    await rm(tempPath, { force: true }).catch((error: NodeJS.ErrnoException) =>
      logTempCleanupFailure(error.code),
    );
  }

  const command = {
    jobId: claims.job_id,
    ownerId: claims.sub,
    sizeBytes: claims.size_bytes,
    sha256: claims.sha256,
    mimeType: claims.mime_type,
  };

  // final 다음에 manifest를 쓴다. 그 사이에 멈추면 재PUT이 EEXIST를 지나 manifest를 만든다.
  await ensureCompletionManifest(dataDir, command, logTempCleanupFailure);

  return command;
};
