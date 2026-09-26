import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { checkGatewayAuth } from './check-gateway-auth';

function buildFakeClient(response: { status: number; data: unknown }) {
  return { get: vi.fn(async () => response) } as unknown as AxiosInstance;
}

describe('checkGatewayAuth', () => {
  it('200에 유효한 userId가 있으면 authenticated를 반환한다', async () => {
    const client = buildFakeClient({ status: 200, data: { userId: 'user-1' } });

    await expect(checkGatewayAuth(client)).resolves.toBe('authenticated');
  });

  it('200이지만 본문이 비어 있으면 unavailable을 반환한다', async () => {
    const client = buildFakeClient({ status: 200, data: {} });

    await expect(checkGatewayAuth(client)).resolves.toBe('unavailable');
  });

  it('200이지만 userId가 빈 문자열이면 unavailable을 반환한다', async () => {
    const client = buildFakeClient({ status: 200, data: { userId: '' } });

    await expect(checkGatewayAuth(client)).resolves.toBe('unavailable');
  });

  it('401이면 rejected를 반환한다', async () => {
    const client = buildFakeClient({ status: 401, data: { error: 'unauthorized' } });

    await expect(checkGatewayAuth(client)).resolves.toBe('rejected');
  });

  it('503이면 unavailable을 반환한다', async () => {
    const client = buildFakeClient({ status: 503, data: { error: 'auth_unavailable' } });

    await expect(checkGatewayAuth(client)).resolves.toBe('unavailable');
  });

  it('500이면 unavailable을 반환한다', async () => {
    const client = buildFakeClient({ status: 500, data: {} });

    await expect(checkGatewayAuth(client)).resolves.toBe('unavailable');
  });

  it('get이 reject하면 unreachable을 반환한다', async () => {
    const client = {
      get: vi.fn(async () => Promise.reject(new Error('network'))),
    } as unknown as AxiosInstance;

    await expect(checkGatewayAuth(client)).resolves.toBe('unreachable');
  });

  it("'/v1/auth-check'와 401을 허용하는 validateStatus로 호출한다", async () => {
    const client = buildFakeClient({ status: 200, data: { userId: 'user-1' } });

    await checkGatewayAuth(client);

    expect(client.get).toHaveBeenCalledWith(
      '/v1/auth-check',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );

    const { validateStatus } = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1];

    expect(validateStatus(401)).toBe(true);
  });
});
