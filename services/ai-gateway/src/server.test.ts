import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from './server.js';

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('게이트웨이 상태 확인', () => {
  it('GET /live에서 프로세스 생존 상태를 반환한다', async () => {
    const server = buildServer();

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
    const server = buildServer();

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
});
