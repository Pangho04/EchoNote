import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);

vi.mock('react-native-url-polyfill/auto', () => {
  order.push('polyfill');

  return {};
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => {
    order.push('createClient');

    return {};
  }),
}));

const FAKE_URL = 'https://example.supabase.co';
const FAKE_KEY = 'publishable-test-key';

describe('createMobileSupabaseClient', () => {
  beforeEach(() => {
    order.length = 0;

    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', FAKE_URL);
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', FAKE_KEY);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('polyfill을 createClient보다 먼저 로드하고 storage·key를 그대로 전달한다', async () => {
    const { createMobileSupabaseClient } = await import('./supabase-client');
    const { createClient } = await import('@supabase/supabase-js');
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };

    createMobileSupabaseClient(storage);

    expect(order).toEqual(['polyfill', 'createClient']);
    expect(createClient).toHaveBeenCalledWith(FAKE_URL, FAKE_KEY, {
      auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  });

  it('EXPO_PUBLIC_SUPABASE_URL이 비어 있으면 모듈 로드가 실패한다', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', '');

    await expect(import('./supabase-client')).rejects.toThrow(
      /EXPO_PUBLIC_SUPABASE_URL is not set/,
    );
  });
});
