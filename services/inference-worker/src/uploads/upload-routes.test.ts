import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { type IncomingMessage, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../server.js';
import { type NonceStore, openNonceStore } from './nonce-store.js';
import { prepareUploadDirectories } from './receive-upload.js';
import type { NotifyUploadCompletion } from './upload-completion-client.js';
import { UploadCompletionError } from './upload-completion-error.js';
import { createUploadGrantVerifier } from './upload-grant-verifier.js';

const SECRET = new Uint8Array(32).fill(7);
const OWNER_ID = '00000000-0000-4000-8000-00000000000a';
const AUDIO = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(40, 1),
]);
const AUDIO_SHA256 = createHash('sha256').update(AUDIO).digest('hex');

let dataDir: string;
let nonceStore: NonceStore;
let server: FastifyInstance;
let logLines: string[];
let notifyUploadCompletion: ReturnType<typeof vi.fn<NotifyUploadCompletion>>;

// Gateway처럼 job마다 첫 통지는 created, 이후는 existing이다.
const fakeGatewayNotify = () => {
  const queuedJobIds = new Set<string>();

  return vi.fn<NotifyUploadCompletion>(async ({ jobId }) => {
    if (queuedJobIds.has(jobId)) return 'existing';

    queuedJobIds.add(jobId);

    return 'created';
  });
};

const startServer = () => {
  nonceStore = openNonceStore(join(dataDir, 'nonces.sqlite'));
  server = buildServer({
    dataDir,
    logger: { level: 'info', stream: { write: (line: string) => void logLines.push(line) } },
    nonceStore,
    notifyUploadCompletion,
    verifyGrant: createUploadGrantVerifier({ secret: SECRET }),
  });
};

const stopServer = async () => {
  await server.close();
  nonceStore.close();
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'upload-routes-'));
  logLines = [];
  notifyUploadCompletion = fakeGatewayNotify();
  await prepareUploadDirectories(dataDir);
  startServer();
});

afterEach(async () => {
  await stopServer();
  await rm(dataDir, { force: true, recursive: true });
});

const issueGrant = ({
  body = AUDIO,
  jobId = randomUUID(),
  jti = randomUUID(),
  secret = SECRET,
} = {}) => {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({
    aud: 'echonote-upload-receiver',
    exp: issuedAt + 300,
    iat: issuedAt,
    iss: 'echonote-ai-gateway',
    job_id: jobId,
    jti,
    mime_type: 'audio/mp4',
    nbf: issuedAt,
    sha256: createHash('sha256').update(body).digest('hex'),
    size_bytes: body.length,
    sub: OWNER_ID,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

const put = (grant: string | undefined, headers: Record<string, string> = {}, payload = AUDIO) =>
  server.inject({
    headers: {
      'content-type': 'application/octet-stream',
      ...(grant === undefined ? {} : { authorization: `Bearer ${grant}` }),
      ...headers,
    },
    method: 'PUT',
    payload,
    url: '/uploads',
  });

const incomingEntries = () => readdir(join(dataDir, '.incoming'));
const finalEntries = async () => (await readdir(join(dataDir, 'final'))).sort();

const completionFailureLog = () =>
  logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.msg === 'upload completion failed');

const listen = async () => {
  await server.listen({ host: '127.0.0.1', port: 0 });

  return (server.server.address() as AddressInfo).port;
};

describe('GET /live', () => {
  it('인증 없이 body 없는 204다', async () => {
    const response = await server.inject({ method: 'GET', url: '/live' });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });
});

describe('PUT /uploads', () => {
  it('검증을 통과한 body를 final/<jobId>.m4a로 확정하고 201을 반환한다', async () => {
    const jobId = randomUUID();
    const response = await put(await issueGrant({ jobId }));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ jobId });
    expect(await readFile(join(dataDir, 'final', `${jobId}.m4a`))).toEqual(AUDIO);
    expect(await incomingEntries()).toEqual([]);
  });

  it.each(['application/octet-stream; x=1', 'APPLICATION/Octet-Stream'])(
    'content-type %j도 octet-stream으로 받는다',
    async (contentType) => {
      expect((await put(await issueGrant(), { 'content-type': contentType })).statusCode).toBe(201);
    },
  );

  it('다른 secret으로 서명한 grant는 401이고 jti를 소비하지 않는다', async () => {
    const jti = randomUUID();
    const response = await put(await issueGrant({ jti, secret: new Uint8Array(32).fill(8) }));

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_upload_grant' });
    expect(response.headers.connection).toBe('close');
    expect(await finalEntries()).toEqual([]);
    expect(nonceStore.consume(jti, 0)).toBe(true);
  });

  it('Authorization 누락은 401이다', async () => {
    const response = await put(undefined);

    expect(response.statusCode).toBe(401);
    expect(response.headers.connection).toBe('close');
  });

  it('1 MiB를 넘는 body도 받는다', async () => {
    const body = Buffer.concat([AUDIO, Buffer.alloc(2 * 1024 * 1024, 3)]);

    expect((await put(await issueGrant({ body }), {}, body)).statusCode).toBe(201);
  });

  it('만료된 grant 거절은 jti를 기록하지 않는다', async () => {
    const jti = randomUUID();
    const verifyLater = createUploadGrantVerifier({
      now: () => Date.now() + 400_000,
      secret: SECRET,
    });

    await stopServer();
    nonceStore = openNonceStore(join(dataDir, 'nonces.sqlite'));
    server = buildServer({ dataDir, nonceStore, notifyUploadCompletion, verifyGrant: verifyLater });

    expect((await put(await issueGrant({ jti }))).statusCode).toBe(401);
    expect(nonceStore.consume(jti, 0)).toBe(true);
  });

  it.each([
    ['body 있는 application/json', { 'content-type': 'application/json' }, AUDIO],
    ['body 있는 text/plain', { 'content-type': 'text/plain' }, AUDIO],
    ['body 없는 text/plain', { 'content-type': 'text/plain' }, undefined],
  ])('%s는 415이고 jti를 소비하지 않는다', async (_label, headers, payload) => {
    const jti = randomUUID();
    const response = await server.inject({
      headers: { authorization: `Bearer ${await issueGrant({ jti })}`, ...headers },
      method: 'PUT',
      payload,
      url: '/uploads',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ error: 'unsupported_media_type' });
    expect(response.headers.connection).toBe('close');
    expect(nonceStore.consume(jti, 0)).toBe(true);
  });

  it.each([
    ['body 있음', AUDIO],
    ['body 없음', undefined],
  ])('content-type 누락(%s)은 415이고 jti를 소비하지 않는다', async (_label, payload) => {
    const jti = randomUUID();
    const response = await server.inject({
      headers: { authorization: `Bearer ${await issueGrant({ jti })}` },
      method: 'PUT',
      payload,
      url: '/uploads',
    });

    expect(response.statusCode).toBe(415);
    expect(response.headers.connection).toBe('close');
    expect(nonceStore.consume(jti, 0)).toBe(true);
  });

  it('같은 grant 재사용은 409다', async () => {
    const grant = await issueGrant();

    expect((await put(grant)).statusCode).toBe(201);

    const replay = await put(grant);

    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({ error: 'upload_grant_used' });
  });

  it('재시작 뒤에도 같은 grant 재사용은 409다', async () => {
    const grant = await issueGrant();

    expect((await put(grant)).statusCode).toBe(201);

    await stopServer();
    startServer();

    expect((await put(grant)).statusCode).toBe(409);
  });

  it('Content-Length가 size_bytes와 다르면 400이고 jti는 소비된다', async () => {
    const grant = await issueGrant({ body: Buffer.concat([AUDIO, Buffer.alloc(1)]) });
    const response = await put(grant);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(response.headers.connection).toBe('close');
    expect((await put(grant)).statusCode).toBe(409);
  });

  it('Content-Length 없는 chunked 요청은 400이다', async () => {
    const port = await listen();
    const grant = await issueGrant();

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest({
        headers: { authorization: `Bearer ${grant}`, 'content-type': 'application/octet-stream' },
        host: '127.0.0.1',
        method: 'PUT',
        path: '/uploads',
        port,
      });

      request.on('response', (response) => {
        response.resume();
        resolve(response);
      });
      request.on('error', reject);
      request.write(AUDIO);
      request.end();
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers.connection).toBe('close');
    expect((await put(grant)).statusCode).toBe(409);
  });

  it('검증 실패는 422이고 final·temp를 남기지 않는다', async () => {
    const grant = await issueGrant({ body: Buffer.from(AUDIO).fill(2, 20, 21) });
    const response = await put(grant);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'upload_verification_failed' });
    expect(await finalEntries()).toEqual([]);
    expect(await incomingEntries()).toEqual([]);
  });

  it('업로드 중 연결이 끊기면 final·temp를 남기지 않는다', async () => {
    const port = await listen();
    const grant = await issueGrant();

    await new Promise<void>((resolve) => {
      const request = httpRequest({
        headers: {
          authorization: `Bearer ${grant}`,
          'content-length': String(AUDIO.length),
          'content-type': 'application/octet-stream',
        },
        host: '127.0.0.1',
        method: 'PUT',
        path: '/uploads',
        port,
      });

      request.on('error', () => resolve());
      request.write(AUDIO.subarray(0, 10), () => {
        setTimeout(() => request.destroy(), 50);
      });
    });

    await vi.waitFor(() => expect(logLines.join('')).toContain('unhandled upload error'));
    expect(await finalEntries()).toEqual([]);
    expect(await incomingEntries()).toEqual([]);
  });

  it('요청 전체 timeout은 30분이다', () => {
    expect(server.server.requestTimeout).toBe(1_800_000);
  });

  it('final link가 실패하면 500이고 temp를 지우며 jti는 소비된다', async () => {
    const grant = await issueGrant();

    await rm(join(dataDir, 'final'), { recursive: true });

    const response = await put(grant);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(response.headers.connection).toBe('close');
    expect(await incomingEntries()).toEqual([]);
    expect((await put(grant)).statusCode).toBe(409);
  });

  it('nonce 기록이 실패하면 500이다', async () => {
    const grant = await issueGrant();

    // server는 닫힌 store를 계속 쓰고, afterEach의 두 번째 close만 막는다.
    nonceStore.close();
    nonceStore = { ...nonceStore, close: () => undefined };

    const response = await put(grant);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(response.headers.connection).toBe('close');
  });

  it('같은 job의 서로 다른 grant는 201 다음 200이고 final은 하나다', async () => {
    const jobId = randomUUID();

    expect((await put(await issueGrant({ jobId }))).statusCode).toBe(201);

    const second = await put(await issueGrant({ jobId }));

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ jobId });
    expect(await finalEntries()).toEqual([`${jobId}.json`, `${jobId}.m4a`]);
  });

  it('Worker token 없는 PUT도 manifest를 남기고 완료 통지 command를 보낸다', async () => {
    const jobId = randomUUID();
    const command = {
      jobId,
      mimeType: 'audio/mp4',
      ownerId: OWNER_ID,
      sha256: AUDIO_SHA256,
      sizeBytes: AUDIO.length,
    };

    expect((await put(await issueGrant({ jobId }))).statusCode).toBe(201);
    expect(notifyUploadCompletion).toHaveBeenCalledWith(command);
    expect(JSON.parse(await readFile(join(dataDir, 'final', `${jobId}.json`), 'utf8'))).toEqual(
      command,
    );
  });

  it.each([
    ['network', 'warn'],
    ['gateway_401', 'error'],
    ['gateway_409', 'error'],
  ] as const)(
    '완료 통지 %s 실패는 502이고 final·manifest를 남기며 reason만 %s 로그에 쓴다',
    async (reason, level) => {
      const jobId = randomUUID();

      notifyUploadCompletion.mockRejectedValueOnce(new UploadCompletionError(reason));

      const response = await put(await issueGrant({ jobId }));
      const logLine = completionFailureLog();

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: 'upload_completion_failed' });
      expect(await finalEntries()).toEqual([`${jobId}.json`, `${jobId}.m4a`]);
      expect(logLine).toMatchObject({ level: level === 'error' ? 50 : 40, reason });
      expect(Object.keys(logLine ?? {}).sort()).toEqual(
        ['hostname', 'level', 'msg', 'pid', 'reason', 'reqId', 'time'].sort(),
      );
      expect((await put(await issueGrant({ jobId }))).statusCode).toBe(201);
    },
  );

  it('완료 통지의 분류 밖 예외는 500이고 오류 문구를 로그에 남기지 않는다', async () => {
    notifyUploadCompletion.mockRejectedValueOnce(
      new Error('https://gateway.example.test token-marker'),
    );

    const response = await put(await issueGrant());

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(logLines.join('')).not.toMatch(/gateway\.example\.test|token-marker/);
  });

  it.each([
    ['손상', () => '{"note":"manifest-body-marker"', 'manifest_invalid'],
    [
      '불일치',
      () =>
        JSON.stringify({
          jobId: '00000000-0000-4000-8000-0000000000aa',
          mimeType: 'audio/mp4',
          ownerId: OWNER_ID,
          sha256: 'f'.repeat(64),
          sizeBytes: AUDIO.length,
        }),
      'manifest_mismatch',
    ],
  ])(
    '기존 manifest가 %s면 502이고 통지하지 않으며 reason만 error 로그에 쓴다',
    async (_label, manifestText, reason) => {
      const jobId = randomUUID();
      const text = manifestText();

      expect((await put(await issueGrant({ jobId }))).statusCode).toBe(201);

      await writeFile(join(dataDir, 'final', `${jobId}.json`), text);
      notifyUploadCompletion.mockClear();

      const response = await put(await issueGrant({ jobId }));

      expect(response.statusCode).toBe(502);
      expect(notifyUploadCompletion).not.toHaveBeenCalled();
      expect(completionFailureLog()).toMatchObject({ level: 50, reason });
      expect(logLines.join('')).not.toMatch(/manifest-body-marker|f{64}/);
      expect(await readFile(join(dataDir, 'final', `${jobId}.m4a`))).toEqual(AUDIO);
      expect(await readFile(join(dataDir, 'final', `${jobId}.json`), 'utf8')).toBe(text);
    },
  );

  it('기존 manifest를 읽지 못하면 500이고 통지하지 않는다', async () => {
    const jobId = randomUUID();

    expect((await put(await issueGrant({ jobId }))).statusCode).toBe(201);

    // link는 EEXIST로 실패하고 readFile은 EISDIR로 실패한다.
    await rm(join(dataDir, 'final', `${jobId}.json`));
    await mkdir(join(dataDir, 'final', `${jobId}.json`));
    notifyUploadCompletion.mockClear();

    const response = await put(await issueGrant({ jobId }));

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(notifyUploadCompletion).not.toHaveBeenCalled();
    expect(await readFile(join(dataDir, 'final', `${jobId}.m4a`))).toEqual(AUDIO);
  });

  it('로그에 grant·sub·sha256·jobId·데이터 경로를 남기지 않는다', async () => {
    const jobId = randomUUID();
    const grant = await issueGrant({ jobId });

    await put(grant);
    await put(grant);
    await put('forged.grant.value');
    await rm(join(dataDir, 'final'), { recursive: true });
    await put(await issueGrant({ jobId }));
    await prepareUploadDirectories(dataDir);
    notifyUploadCompletion.mockRejectedValueOnce(new UploadCompletionError('gateway_401'));
    await put(await issueGrant({ jobId }));

    const logs = logLines.join('');

    expect(logs).toContain('unhandled upload error');
    expect(logs).toContain('upload grant rejected');
    expect(logs).toContain('upload completion failed');

    // pino는 JSON으로 쓰므로 Windows 경로의 `\`는 escape된 형태로 나타난다.
    for (const secret of [
      grant,
      OWNER_ID,
      AUDIO_SHA256,
      jobId,
      dataDir,
      JSON.stringify(dataDir).slice(1, -1),
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
