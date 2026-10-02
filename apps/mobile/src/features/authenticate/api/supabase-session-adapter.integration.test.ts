import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_STORAGE_KEY } from '@/shared/api/supabase-client';

import { createSupabaseSession } from './supabase-session-adapter';

vi.hoisted(() => {
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
  vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'http://127.0.0.1:4317');
});

vi.mock('react-native-url-polyfill/auto', () => ({}));

const NOW_MS = Date.UTC(2026, 9, 1, 0, 0, 0);

const USER = {
  id: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'user@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const EXPIRED_SESSION = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  token_type: 'bearer',
  expires_in: 3_600,
  expires_at: Math.floor(NOW_MS / 1_000) - 60,
  user: USER,
};

type FetchMode = 'offline' | 'online' | 'hang';

// 실제 auth-js가 보내는 요청에 네트워크 상태만 바꿔 응답한다. 'hang'은 resolveHanging을 부를 때까지 응답하지 않는다.
function buildFakeNetwork() {
  const network = {
    mode: 'offline' as FetchMode,
    refreshRequests: 0,
    resolveHanging: () => {},
    fetch: vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);

      if (url.includes('grant_type=refresh_token')) network.refreshRequests += 1;

      if (network.mode === 'offline') throw new TypeError('Network request failed');

      if (network.mode === 'hang') {
        await new Promise<void>((resolve) => {
          network.resolveHanging = resolve;
        });
      }

      if (url.includes('/logout')) return new Response(null, { status: 204 });

      return Response.json({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        token_type: 'bearer',
        expires_in: 3_600,
        expires_at: Math.floor(Date.now() / 1_000) + 3_600,
        user: USER,
      });
    }),
  };

  return network;
}

function buildMemoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
}

function setUp(network: ReturnType<typeof buildFakeNetwork>) {
  const storage = buildMemoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(EXPIRED_SESSION) });
  const client = createClient('https://example.supabase.co', 'publishable-test-key', {
    auth: {
      storage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: network.fetch },
  });

  return { storage, client, session: createSupabaseSession(client.auth, storage) };
}

describe('createSupabaseSession + 실제 auth-js', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('만료 세션 + 오프라인이면 INITIAL_SESSION이 늦게 null로 오고 어댑터는 무시한다', async () => {
    const network = buildFakeNetwork();
    const { client, session } = setUp(network);
    const listener = vi.fn();
    let initial: { afterMs: number; session: unknown } | null = null;

    session.subscribe(listener);
    client.auth.onAuthStateChange((event, payload) => {
      if (event === 'INITIAL_SESSION') initial = { afterMs: Date.now() - NOW_MS, session: payload };
    });

    await expect(session.restore()).resolves.toEqual({ kind: 'signedIn', userId: 'user-1' });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(initial).not.toBeNull();
    expect(initial!.session).toBeNull();
    expect(initial!.afterMs).toBeGreaterThan(3_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('강제 로그아웃 뒤 네트워크가 돌아와 갱신이 성공해도 저장소는 비어 있고 signedIn이 되지 않는다', async () => {
    const network = buildFakeNetwork();
    const { storage, client, session } = setUp(network);
    const listener = vi.fn();
    const events: string[] = [];

    session.subscribe(listener);
    client.auth.onAuthStateChange((event) => events.push(event));

    void session.signOut();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(storage.values.has(AUTH_STORAGE_KEY)).toBe(false);

    network.mode = 'online';
    await vi.advanceTimersByTimeAsync(120_000);

    expect(network.refreshRequests).toBeGreaterThan(0);
    expect(storage.values.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'signedIn' }));
    expect(listener).toHaveBeenNthCalledWith(1, { kind: 'signedOut', cause: 'user' });
    expect(events).not.toContain('TOKEN_REFRESHED');
  });

  it('갱신 요청이 진행 중일 때 3초 경로로 키를 지우면 그 요청이 끝난 뒤에도 키가 없다', async () => {
    const network = buildFakeNetwork();

    network.mode = 'hang';

    const { storage, session } = setUp(network);
    const listener = vi.fn();

    session.subscribe(listener);
    void session.signOut();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(network.refreshRequests).toBeGreaterThan(0);
    expect(storage.values.has(AUTH_STORAGE_KEY)).toBe(false);

    network.mode = 'online';
    network.resolveHanging();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(storage.values.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'signedIn' }));
  });
});
