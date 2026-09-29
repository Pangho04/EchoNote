import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from './environment.js';

const GRANT_SECRET_BYTES = Buffer.alloc(32, 7);
const GRANT_SECRET_B64 = GRANT_SECRET_BYTES.toString('base64');
const DATA_DIR = '/srv/echonote-worker';

beforeEach(() => {
  vi.stubEnv('UPLOAD_GRANT_SECRET_B64', GRANT_SECRET_B64);
  vi.stubEnv('WORKER_DATA_DIR', DATA_DIR);
  vi.stubEnv('ECHONOTE_WORKER_PORT', undefined);
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
  it('데이터 경로·기본 포트 4318·secret byte를 반환한다', () => {
    expect(loadEnvironment()).toEqual({
      dataDir: DATA_DIR,
      port: 4318,
      uploadGrantSecret: new Uint8Array(GRANT_SECRET_BYTES),
    });
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

    expect(captureError().message).toBe(
      'UPLOAD_GRANT_SECRET_B64 must be standard Base64 of at least 32 bytes',
    );
  });

  it.each([
    ['누락', undefined],
    ['빈 문자열', ''],
    ['상대 경로', 'worker-data'],
  ])('WORKER_DATA_DIR %s는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('WORKER_DATA_DIR', value);

    expect(captureError().message).toBe('WORKER_DATA_DIR must be an absolute path');
  });

  it('ECHONOTE_WORKER_PORT를 정수로 읽는다', () => {
    vi.stubEnv('ECHONOTE_WORKER_PORT', '5000');

    expect(loadEnvironment().port).toBe(5000);
  });

  it.each(['0', '65536', '-1', '43.5', '1e3', ' 4318', ''])(
    'ECHONOTE_WORKER_PORT %j는 throw한다',
    (value) => {
      vi.stubEnv('ECHONOTE_WORKER_PORT', value);

      expect(captureError().message).toBe(
        'ECHONOTE_WORKER_PORT must be an integer from 1 to 65535',
      );
    },
  );
});
