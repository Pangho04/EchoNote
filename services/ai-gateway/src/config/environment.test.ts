import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from './environment.js';

const SECRET = 'sb_secret_TESTVALUE';
const GRANT_SECRET_BYTES = Buffer.alloc(32, 7);
const GRANT_SECRET_B64 = GRANT_SECRET_BYTES.toString('base64');

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', SECRET);
  vi.stubEnv('UPLOAD_GRANT_SECRET_B64', GRANT_SECRET_B64);
  vi.stubEnv('WORKER_RECEIVER_BASE_URL', 'https://receiver.example.ts.net');
});

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
    vi.stubEnv('SUPABASE_SECRET_KEY', `  ${SECRET}\n`);

    expect(loadEnvironment()).toEqual({
      supabaseSecretKey: SECRET,
      supabaseUrl: 'https://example.supabase.co',
      uploadGrantSecret: new Uint8Array(GRANT_SECRET_BYTES),
      workerReceiverOrigin: 'https://receiver.example.ts.net',
    });
  });

  it('SUPABASE_SECRET_KEY가 없으면 throw한다', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', undefined);

    expect(() => loadEnvironment()).toThrow('SUPABASE_SECRET_KEY');
  });

  it.each([
    ['중간 줄바꿈', `${SECRET}\nX`],
    ['비ASCII', `${SECRET}키`],
  ])('%s가 든 key는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('SUPABASE_SECRET_KEY', value);

    const error = captureError();

    expect(error.message).toContain('SUPABASE_SECRET_KEY');
    expect(error.message).not.toContain('TESTVALUE');
    expect(error.stack).not.toContain('TESTVALUE');
  });

  it('UPLOAD_GRANT_SECRET_B64 결과는 Buffer가 아닌 복사한 Uint8Array다', () => {
    const { uploadGrantSecret } = loadEnvironment();

    expect(Buffer.isBuffer(uploadGrantSecret)).toBe(false);
    expect(uploadGrantSecret.byteLength).toBe(uploadGrantSecret.buffer.byteLength);
  });

  it.each([
    ['누락', undefined],
    ['빈 문자열', ''],
    ['32 byte 미만', Buffer.alloc(31, 7).toString('base64')],
    [
      'URL-safe alphabet',
      Buffer.alloc(32, 0xfb).toString('base64').replaceAll('+', '-').replaceAll('/', '_'),
    ],
    ['alphabet 밖 문자', `${GRANT_SECRET_B64.slice(0, -4)}ab!c`],
    ['padding 누락', GRANT_SECRET_B64.replace(/=+$/, '')],
    ['앞뒤 공백', ` ${GRANT_SECRET_B64}`],
    ['끝 줄바꿈', `${GRANT_SECRET_B64}\n`],
    ['canonical이 아닌 끝 비트', `${GRANT_SECRET_B64.slice(0, -2)}d=`],
  ])('UPLOAD_GRANT_SECRET_B64 %s는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('UPLOAD_GRANT_SECRET_B64', value);

    const error = captureError();

    expect(error.message).toBe(
      'UPLOAD_GRANT_SECRET_B64 must be standard Base64 of at least 32 bytes',
    );
  });

  it.each([
    ['누락', undefined],
    ['상대 경로', 'receiver.example.ts.net'],
    ['http', 'http://receiver.example.ts.net'],
    ['path', 'https://receiver.example.ts.net/uploads'],
    ['query', 'https://receiver.example.ts.net/?token=x'],
    ['빈 query', 'https://receiver.example.ts.net/?'],
    ['hash', 'https://receiver.example.ts.net/#x'],
    ['userinfo', 'https://user:pass@receiver.example.ts.net'],
  ])('WORKER_RECEIVER_BASE_URL %s는 throw한다', (_label, value) => {
    vi.stubEnv('WORKER_RECEIVER_BASE_URL', value);

    const error = captureError();

    expect(error.message).toContain('WORKER_RECEIVER_BASE_URL');
    expect(error.message).not.toContain('receiver.example');
  });

  it('WORKER_RECEIVER_BASE_URL 끝 슬래시와 기본 포트는 origin으로 줄인다', () => {
    vi.stubEnv('WORKER_RECEIVER_BASE_URL', 'https://receiver.example.ts.net:443/');

    expect(loadEnvironment().workerReceiverOrigin).toBe('https://receiver.example.ts.net');
  });
});
