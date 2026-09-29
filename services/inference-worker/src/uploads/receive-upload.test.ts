import { createHash } from 'node:crypto';
import type * as FsPromises from 'node:fs/promises';
import { link, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// probe 실패는 권한으로 만들 수 없다. Windows chmod는 디렉터리 안 파일 생성을 막지 않는다.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return { ...actual, link: vi.fn(actual.link) };
});

import {
  prepareUploadDirectories,
  receiveUpload,
  UploadVerificationError,
} from './receive-upload.js';
import { UploadCompletionError } from './upload-completion-error.js';
import type { UploadGrantClaims } from './upload-grant-verifier.js';

const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const AUDIO = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(40, 1),
]);

const claimsFor = (body: Buffer): UploadGrantClaims => ({
  aud: 'echonote-upload-receiver',
  exp: 1_790_000_300,
  iat: 1_790_000_000,
  iss: 'echonote-ai-gateway',
  job_id: JOB_ID,
  jti: '00000000-0000-4000-8000-0000000000e1',
  mime_type: 'audio/mp4',
  nbf: 1_790_000_000,
  sha256: createHash('sha256').update(body).digest('hex'),
  size_bytes: body.length,
  sub: '00000000-0000-4000-8000-00000000000a',
});

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'receive-upload-'));
  await prepareUploadDirectories(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

const receive = (chunks: Buffer[], claims: UploadGrantClaims) =>
  receiveUpload({
    body: Readable.from(chunks),
    claims,
    dataDir,
    logTempCleanupFailure: vi.fn(),
  });

const incomingEntries = () => readdir(join(dataDir, '.incoming'));
const finalEntries = async () => (await readdir(join(dataDir, 'final'))).sort();
const manifestPath = () => join(dataDir, 'final', `${JOB_ID}.json`);

const commandFor = (body: Buffer) => ({
  jobId: JOB_ID,
  mimeType: 'audio/mp4',
  ownerId: '00000000-0000-4000-8000-00000000000a',
  sha256: createHash('sha256').update(body).digest('hex'),
  sizeBytes: body.length,
});

describe('prepareUploadDirectories', () => {
  it('남은 temp와 probe 잔여를 지우고 final 파일은 보존한다', async () => {
    await writeFile(join(dataDir, '.incoming', 'stale'), 'x');
    await mkdir(join(dataDir, '.incoming', 'stale-dir'));
    await writeFile(join(dataDir, 'final', '.probe-stale'), 'x');
    await writeFile(join(dataDir, 'final', `${JOB_ID}.m4a`), 'kept');
    await writeFile(join(dataDir, 'nonces.sqlite'), 'kept');

    await prepareUploadDirectories(dataDir);

    expect(await incomingEntries()).toEqual([]);
    expect(await finalEntries()).toEqual([`${JOB_ID}.m4a`]);
    expect(await readFile(join(dataDir, 'nonces.sqlite'), 'utf8')).toBe('kept');
  });

  it('probe link가 실패하면 흔적 없이 throw한다', async () => {
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('link failed'), { code: 'EPERM' }),
    );

    await expect(prepareUploadDirectories(dataDir)).rejects.toThrow();
    expect(await incomingEntries()).toEqual([]);
    expect(await finalEntries()).toEqual([]);
  });
});

describe('receiveUpload', () => {
  it('검증을 통과한 body를 final에 확정하고 manifest를 남긴 뒤 command를 반환한다', async () => {
    await expect(
      receive([AUDIO.subarray(0, 3), AUDIO.subarray(3)], claimsFor(AUDIO)),
    ).resolves.toEqual(commandFor(AUDIO));

    expect(await readFile(join(dataDir, 'final', `${JOB_ID}.m4a`))).toEqual(AUDIO);
    expect(JSON.parse(await readFile(manifestPath(), 'utf8'))).toEqual(commandFor(AUDIO));
    expect(await incomingEntries()).toEqual([]);
  });

  it('같은 job final·manifest가 이미 있으면 덮어쓰지 않고 같은 command를 반환한다', async () => {
    await receive([AUDIO], claimsFor(AUDIO));

    await expect(receive([AUDIO], claimsFor(AUDIO))).resolves.toEqual(commandFor(AUDIO));
    expect(await finalEntries()).toEqual([`${JOB_ID}.json`, `${JOB_ID}.m4a`]);
    expect(await incomingEntries()).toEqual([]);
  });

  it('final만 있고 manifest가 없으면 재수신이 manifest를 만든다', async () => {
    await receive([AUDIO], claimsFor(AUDIO));
    await rm(manifestPath());

    await expect(receive([AUDIO], claimsFor(AUDIO))).resolves.toEqual(commandFor(AUDIO));
    expect(JSON.parse(await readFile(manifestPath(), 'utf8'))).toEqual(commandFor(AUDIO));
  });

  it.each([
    ['JSON 아님', '{"jobId":', 'manifest_invalid'],
    ['schema 밖 필드', JSON.stringify({ ...commandFor(AUDIO), extra: 1 }), 'manifest_invalid'],
    [
      '다른 sha256',
      JSON.stringify({ ...commandFor(AUDIO), sha256: 'f'.repeat(64) }),
      'manifest_mismatch',
    ],
  ])('기존 manifest가 %s면 %s이고 final·manifest를 그대로 둔다', async (_label, text, reason) => {
    await receive([AUDIO], claimsFor(AUDIO));
    await writeFile(manifestPath(), text);

    await expect(receive([AUDIO], claimsFor(AUDIO))).rejects.toEqual(
      expect.objectContaining({ constructor: UploadCompletionError, reason }),
    );
    expect(await readFile(join(dataDir, 'final', `${JOB_ID}.m4a`))).toEqual(AUDIO);
    expect(await readFile(manifestPath(), 'utf8')).toBe(text);
    expect(await incomingEntries()).toEqual([]);
  });

  const notFtyp = Buffer.from(AUDIO).fill(0x61, 4, 8);
  const short = AUDIO.subarray(0, 7);

  it.each([
    ['길이 불일치', AUDIO.subarray(0, -1), claimsFor(AUDIO)],
    ['hash 불일치', Buffer.from(AUDIO).fill(2, 20, 21), claimsFor(AUDIO)],
    ['ftyp magic 아님', notFtyp, claimsFor(notFtyp)],
    ['8 byte 미만', short, claimsFor(short)],
  ])(
    '%s는 UploadVerificationError이고 final·temp를 남기지 않는다',
    async (_label, body, claims) => {
      await expect(receive([body], claims)).rejects.toBeInstanceOf(UploadVerificationError);
      expect(await finalEntries()).toEqual([]);
      expect(await incomingEntries()).toEqual([]);
    },
  );

  it('stream이 중간에 실패하면 final·temp를 남기지 않는다', async () => {
    let sentFirstChunk = false;
    // 소비자가 두 번째 chunk를 읽으려 할 때 끊는다. pipeline이 연결되기 전에는 실패하지 않는다.
    const body = new Readable({
      read() {
        if (sentFirstChunk) return void this.destroy(new Error('aborted'));

        sentFirstChunk = true;
        this.push(AUDIO.subarray(0, 10));
      },
    });

    await expect(
      receiveUpload({ body, claims: claimsFor(AUDIO), dataDir, logTempCleanupFailure: vi.fn() }),
    ).rejects.toThrow('aborted');
    expect(await finalEntries()).toEqual([]);
    expect(await incomingEntries()).toEqual([]);
  });

  it('final 디렉터리가 없어 link가 실패하면 throw하고 temp를 지운다', async () => {
    await rm(join(dataDir, 'final'), { recursive: true });

    await expect(receive([AUDIO], claimsFor(AUDIO))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await incomingEntries()).toEqual([]);
  });
});
