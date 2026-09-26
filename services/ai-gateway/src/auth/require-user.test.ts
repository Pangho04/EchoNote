import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AccessTokenVerifier,
  InvalidAccessTokenError,
  VerifierUnavailableError,
} from './access-token-verifier.js';
import { getUserContext, installAuth } from './require-user.js';

const servers: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildGuardedServer = (verify: AccessTokenVerifier['verify']) => {
  const logLines: string[] = [];
  const server = Fastify({
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
  });
  const handler = vi.fn(async (request: Parameters<typeof getUserContext>[0]) => ({
    userId: getUserContext(request).id,
  }));

  server.register(
    async (v1) => {
      installAuth(v1, { verify });

      v1.get('/probe', handler);
    },
    { prefix: '/v1' },
  );

  server.get('/outside', async (request) => getUserContext(request));

  servers.push(server);

  return { handler, logLines, server };
};

describe('installAuth', () => {
  it('유효한 Bearer 토큰이면 handler가 사용자 id를 받는다', async () => {
    const verify = vi.fn(async () => ({ id: 'user-1' }));
    const { handler, server } = buildGuardedServer(verify);

    const response = await server.inject({
      headers: { authorization: 'bearer token-1' },
      method: 'GET',
      url: '/v1/probe',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user-1' });
    expect(verify).toHaveBeenCalledWith('token-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'Basic dXNlcg==', 'Bearer ', 'Bearer  token'])(
    'Authorization이 %s이면 검증 없이 401을 반환한다',
    async (authorization) => {
      const verify = vi.fn(async () => ({ id: 'user-1' }));
      const { handler, server } = buildGuardedServer(verify);

      const response = await server.inject({
        headers: authorization === undefined ? {} : { authorization },
        method: 'GET',
        url: '/v1/probe',
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(verify).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('검증기가 토큰을 거부하면 401을 반환하고 handler를 호출하지 않는다', async () => {
    const { handler, server } = buildGuardedServer(async () => {
      throw new InvalidAccessTokenError();
    });

    const response = await server.inject({
      headers: { authorization: 'Bearer token-1' },
      method: 'GET',
      url: '/v1/probe',
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(handler).not.toHaveBeenCalled();
  });

  it('검증기를 쓸 수 없으면 503과 reason만 담은 warn 로그를 남긴다', async () => {
    const { handler, logLines, server } = buildGuardedServer(async () => {
      throw new VerifierUnavailableError('ERR_JWKS_TIMEOUT');
    });

    const response = await server.inject({
      headers: { authorization: 'Bearer token-1' },
      method: 'GET',
      url: '/v1/probe',
    });
    const warnings = logLines.map((line) => JSON.parse(line)).filter((entry) => entry.level === 40);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'auth_unavailable' });
    expect(handler).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('ERR_JWKS_TIMEOUT');
  });

  it('캡슐 밖 route는 인증 hook을 거치지 않아 getUserContext가 500을 낸다', async () => {
    const verify = vi.fn(async () => ({ id: 'user-1' }));
    const { server } = buildGuardedServer(verify);

    const response = await server.inject({ method: 'GET', url: '/outside' });

    expect(response.statusCode).toBe(500);
    expect(verify).not.toHaveBeenCalled();
  });
});
