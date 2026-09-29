import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkerAuth } from './require-worker.js';

const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');

const servers: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildGuardedServer = () => {
  const logLines: string[] = [];
  const server = Fastify({
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
  });
  const handler = vi.fn(async () => ({ ok: true }));

  server.register(async (worker) => {
    installWorkerAuth(worker, WORKER_API_TOKEN);

    worker.post('/probe', handler);
  });

  servers.push(server);

  return { handler, logLines, server };
};

describe('installWorkerAuth', () => {
  it.each([`Bearer ${WORKER_API_TOKEN}`, `bearer ${WORKER_API_TOKEN}`])(
    'Authorization이 %s 형태면 handler를 호출한다',
    async (authorization) => {
      const { handler, server } = buildGuardedServer();

      const response = await server.inject({
        headers: { authorization },
        method: 'POST',
        url: '/probe',
      });

      expect(response.statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['누락', undefined],
    ['Basic scheme', `Basic ${WORKER_API_TOKEN}`],
    ['공백 2개', `Bearer  ${WORKER_API_TOKEN}`],
    ['다른 token', `Bearer ${Buffer.alloc(32, 8).toString('base64')}`],
    ['길이가 다른 token', `Bearer ${WORKER_API_TOKEN}A`],
    ['앞부분만 같은 token', `Bearer ${WORKER_API_TOKEN.slice(0, -4)}`],
  ])('Authorization %s는 401이고 handler를 호출하지 않는다', async (_label, authorization) => {
    const { handler, logLines, server } = buildGuardedServer();

    const response = await server.inject({
      headers: authorization === undefined ? {} : { authorization },
      method: 'POST',
      url: '/probe',
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(handler).not.toHaveBeenCalled();
    expect(response.body).not.toContain(WORKER_API_TOKEN);
    expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
  });
});
