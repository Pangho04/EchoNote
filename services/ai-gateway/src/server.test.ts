import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvalidAccessTokenError } from './auth/access-token-verifier.js';
import { buildServer } from './server.js';

const USER_TOKEN = 'user-token-probe-5d1e';
const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');

const verifier = {
  verify: async (token: string) => {
    if (token !== USER_TOKEN) throw new InvalidAccessTokenError();

    return { id: 'user-1' };
  },
};
const jobRepository = {
  claimJob: vi.fn(),
  completeUpload: vi.fn(),
  createJob: vi.fn(),
  failJob: vi.fn(),
  findOwnedJob: vi.fn(),
  renewJobLease: vi.fn(),
};
const issueUploadGrant = vi.fn();
const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('게이트웨이 상태 확인', () => {
  it('GET /live에서 프로세스 생존 상태를 반환한다', async () => {
    const server = buildServer({
      issueUploadGrant,
      jobRepository,
      verifier,
      workerApiToken: WORKER_API_TOKEN,
    });

    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'echonote-ai-gateway',
      status: 'live',
    });
  });

  it('GET /ready에서 추론 런타임 미구성 상태를 구분한다', async () => {
    const server = buildServer({
      issueUploadGrant,
      jobRepository,
      verifier,
      workerApiToken: WORKER_API_TOKEN,
    });

    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      checks: {
        llm: 'not_configured',
        stt: 'not_configured',
      },
      status: 'not_ready',
    });
  });

  it('GET /v1/auth-check는 인증된 사용자 id를 반환한다', async () => {
    const server = buildServer({
      issueUploadGrant,
      jobRepository,
      verifier,
      workerApiToken: WORKER_API_TOKEN,
    });

    servers.push(server);

    const response = await server.inject({
      headers: { authorization: `Bearer ${USER_TOKEN}` },
      method: 'GET',
      url: '/v1/auth-check',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user-1' });
  });

  it('GET /v1/auth-check는 토큰이 없으면 401을 반환하고 /live는 인증 없이 열린다', async () => {
    const server = buildServer({
      issueUploadGrant,
      jobRepository,
      verifier,
      workerApiToken: WORKER_API_TOKEN,
    });

    servers.push(server);

    const [guarded, open] = await Promise.all([
      server.inject({ method: 'GET', url: '/v1/auth-check' }),
      server.inject({ method: 'GET', url: '/live' }),
    ]);

    expect(guarded.statusCode).toBe(401);
    expect(open.statusCode).toBe(200);
  });

  it('사용자 JWT는 worker route를, Worker token은 사용자 route를 열지 못한다', async () => {
    const logLines: string[] = [];
    const server = buildServer({
      issueUploadGrant,
      jobRepository,
      logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
      verifier,
      workerApiToken: WORKER_API_TOKEN,
    });

    servers.push(server);

    const [userOnWorker, workerOnUser] = await Promise.all([
      server.inject({
        headers: { authorization: `Bearer ${USER_TOKEN}`, 'content-type': 'application/json' },
        method: 'POST',
        payload: '{}',
        url: '/v1/worker/upload-completions',
      }),
      server.inject({
        headers: { authorization: `Bearer ${WORKER_API_TOKEN}` },
        method: 'GET',
        url: '/v1/auth-check',
      }),
    ]);

    expect(userOnWorker.statusCode).toBe(401);
    expect(workerOnUser.statusCode).toBe(401);
    expect(jobRepository.completeUpload).not.toHaveBeenCalled();

    for (const text of [userOnWorker.body, workerOnUser.body, logLines.join('')]) {
      expect(text).not.toContain(USER_TOKEN);
      expect(text).not.toContain(WORKER_API_TOKEN);
    }
  });
});
