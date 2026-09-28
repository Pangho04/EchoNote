import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from './environment.js';

const SECRET = 'sb_secret_TESTVALUE';

afterEach(() => {
  vi.unstubAllEnvs();
});

const captureError = () => {
  try {
    loadEnvironment();
  } catch (error) {
    return error as Error;
  }

  throw new Error('loadEnvironment did not throw');
};

describe('loadEnvironment', () => {
  it('SUPABASE_SECRET_KEY 앞뒤 공백을 제거해 반환한다', () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', `  ${SECRET}\n`);

    expect(loadEnvironment()).toEqual({
      supabaseSecretKey: SECRET,
      supabaseUrl: 'https://example.supabase.co',
    });
  });

  it('SUPABASE_SECRET_KEY가 없으면 throw한다', () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', undefined);

    expect(() => loadEnvironment()).toThrow('SUPABASE_SECRET_KEY');
  });

  it.each([
    ['중간 줄바꿈', `${SECRET}\nX`],
    ['비ASCII', `${SECRET}키`],
  ])('%s가 든 key는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', value);

    const error = captureError();

    expect(error.message).toContain('SUPABASE_SECRET_KEY');
    expect(error.message).not.toContain('TESTVALUE');
    expect(error.stack).not.toContain('TESTVALUE');
  });
});
