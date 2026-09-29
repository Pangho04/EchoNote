import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { UploadGrantClaims } from './upload-grant-verifier.js';

const INCOMING_DIR = '.incoming';
const FINAL_DIR = 'final';
const PROBE_PREFIX = '.probe-';

// 첫 box의 size(4 byte) 다음 offset 4에 type `ftyp`가 있어야 받는다.
const FTYP_MAGIC = Buffer.from('ftyp');
const MAGIC_END = 8;

export type UploadOutcome = 'created' | 'existing';

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

type ReceiveUploadOptions = {
  body: Readable;
  claims: UploadGrantClaims;
  dataDir: string;
  logTempCleanupFailure: (code: unknown) => void;
};

// body를 temp에 받아 길이·SHA-256·magic을 확인한 뒤 final에 link한다. temp는 항상 지운다.
export const receiveUpload = async ({
  body,
  claims,
  dataDir,
  logTempCleanupFailure,
}: ReceiveUploadOptions): Promise<UploadOutcome> => {
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
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'existing';

      throw error;
    }

    return 'created';
  } finally {
    await rm(tempPath, { force: true }).catch((error: NodeJS.ErrnoException) =>
      logTempCleanupFailure(error.code),
    );
  }
};
