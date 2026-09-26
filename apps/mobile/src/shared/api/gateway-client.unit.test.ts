import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { createGatewayClient } from './gateway-client';

function stubAdapter(client: ReturnType<typeof createGatewayClient>) {
  const adapter = vi.fn(async (config: AxiosRequestConfig) => ({
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));

  client.defaults.adapter = adapter as unknown as AxiosAdapter;

  return adapter;
}

describe('createGatewayClient', () => {
  it('baseURL과 timeout을 설정한다', () => {
    const client = createGatewayClient('http://127.0.0.1:4317', async () => null);

    expect(client.defaults.baseURL).toBe('http://127.0.0.1:4317');
    expect(client.defaults.timeout).toBe(10_000);
  });

  it('token이 있으면 Authorization header를 붙인다', async () => {
    const client = createGatewayClient('http://127.0.0.1:4317', async () => 'tok');
    const adapter = stubAdapter(client);

    await client.get('/v1/auth-check');

    expect(adapter.mock.calls[0]![0].headers?.Authorization).toBe('Bearer tok');
  });

  it('token이 null이면 Authorization header를 붙이지 않는다', async () => {
    const client = createGatewayClient('http://127.0.0.1:4317', async () => null);
    const adapter = stubAdapter(client);

    await client.get('/v1/auth-check');

    expect(adapter.mock.calls[0]![0].headers?.Authorization).toBeUndefined();
  });
});
