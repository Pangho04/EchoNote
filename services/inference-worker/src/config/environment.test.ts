import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from './environment.js';

const GRANT_SECRET_BYTES = Buffer.alloc(32, 7);
const GRANT_SECRET_B64 = GRANT_SECRET_BYTES.toString('base64');
const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');
const DATA_DIR = '/srv/echonote-worker';
const DOCKER_PATH = '/usr/local/bin/docker';
const GATEWAY_ORIGIN = 'https://gateway.example.test';

beforeEach(() => {
  vi.stubEnv('UPLOAD_GRANT_SECRET_B64', GRANT_SECRET_B64);
  vi.stubEnv('WORKER_API_TOKEN', WORKER_API_TOKEN);
  vi.stubEnv('GATEWAY_BASE_URL', GATEWAY_ORIGIN);
  vi.stubEnv('WORKER_DATA_DIR', DATA_DIR);
  vi.stubEnv('DOCKER_PATH', DOCKER_PATH);
  vi.stubEnv('ECHONOTE_WORKER_PORT', undefined);
  vi.stubEnv('WORKER_CONCURRENCY', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, 'platform', { value: PLATFORM });
});

const PLATFORM = process.platform;

const asWindows = () => Object.defineProperty(process, 'platform', { value: 'win32' });

const captureError = () => {
  try {
    loadEnvironment();
  } catch (error) {
    return error as Error;
  }

  throw new Error('loadEnvironment did not throw');
};

describe('loadEnvironment', () => {
  it('데이터 경로·docker 경로·Gateway origin·기본 포트 4318·동시 처리 3·secret byte·Worker token을 반환한다', () => {
    expect(loadEnvironment()).toEqual({
      concurrency: 3,
      dataDir: DATA_DIR,
      dockerPath: DOCKER_PATH,
      gatewayOrigin: GATEWAY_ORIGIN,
      port: 4318,
      uploadGrantSecret: new Uint8Array(GRANT_SECRET_BYTES),
      workerApiToken: WORKER_API_TOKEN,
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
    ['32 byte 미만', Buffer.alloc(31, 9).toString('base64')],
    ['padding 누락', WORKER_API_TOKEN.replace(/=+$/, '')],
    ['끝 줄바꿈', `${WORKER_API_TOKEN}\n`],
  ])('WORKER_API_TOKEN %s는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('WORKER_API_TOKEN', value);

    const error = captureError();

    expect(error.message).toBe('WORKER_API_TOKEN must be standard Base64 of at least 32 bytes');
    expect(error.stack).not.toContain(WORKER_API_TOKEN.slice(0, 20));
  });

  it('WORKER_API_TOKEN이 UPLOAD_GRANT_SECRET_B64와 같으면 값을 드러내지 않고 throw한다', () => {
    vi.stubEnv('WORKER_API_TOKEN', GRANT_SECRET_B64);

    const error = captureError();

    expect(error.message).toBe('WORKER_API_TOKEN must differ from UPLOAD_GRANT_SECRET_B64');
    expect(error.stack).not.toContain(GRANT_SECRET_B64);
  });

  it.each([
    ['https origin 뒤 slash', `${GATEWAY_ORIGIN}/`, GATEWAY_ORIGIN],
    ['loopback IPv4 http', 'http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['localhost http', 'http://localhost:3000', 'http://localhost:3000'],
  ])('GATEWAY_BASE_URL %s는 origin으로 읽는다', (_label, value, origin) => {
    vi.stubEnv('GATEWAY_BASE_URL', value);

    expect(loadEnvironment().gatewayOrigin).toBe(origin);
  });

  it.each([
    ['누락', undefined, 'GATEWAY_BASE_URL must be an absolute URL'],
    ['상대 URL', '/v1', 'GATEWAY_BASE_URL must be an absolute URL'],
    ['userinfo', 'https://user:secret-pass@gateway.example.test'],
    ['query', `${GATEWAY_ORIGIN}/?key=secret-query`],
    ['hash', `${GATEWAY_ORIGIN}/#secret-hash`],
    ['path', `${GATEWAY_ORIGIN}/secret-path`],
    ['loopback 밖 http', 'http://gateway.example.test'],
  ])('GATEWAY_BASE_URL %s는 값을 드러내지 않고 throw한다', (_label, value, message?: string) => {
    vi.stubEnv('GATEWAY_BASE_URL', value);

    const error = captureError();

    expect(error.message).toBe(
      message ??
        'GATEWAY_BASE_URL must be an https origin without path, query, hash or userinfo (http is allowed only for localhost)',
    );
    expect(error.stack).not.toMatch(/secret-|gateway\.example/);
  });

  it.each([
    ['누락', undefined],
    ['빈 문자열', ''],
    ['상대 경로', 'worker-data'],
  ])('WORKER_DATA_DIR %s는 값을 드러내지 않고 throw한다', (_label, value) => {
    vi.stubEnv('WORKER_DATA_DIR', value);

    expect(captureError().message).toBe(
      'WORKER_DATA_DIR must be an absolute path (a drive path on Windows)',
    );
  });

  it('WORKER_DATA_DIR에 쉼표가 있으면 docker --mount 값이 갈라지므로 throw한다', () => {
    vi.stubEnv('WORKER_DATA_DIR', '/srv/echo,note');

    expect(captureError().message).toBe('WORKER_DATA_DIR must not contain a comma');
  });

  it('Windows에서는 드라이브 경로와 .exe docker 경로를 받는다', () => {
    asWindows();
    vi.stubEnv('WORKER_DATA_DIR', 'D:\\echonote-worker');
    vi.stubEnv('DOCKER_PATH', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.EXE');

    expect(loadEnvironment()).toMatchObject({ dataDir: 'D:\\echonote-worker' });
  });

  it.each([
    ['UNC 공유 경로', '\\\\server\\share\\echonote'],
    ['드라이브 없는 루트', '\\echonote'],
    ['POSIX 경로', '/srv/echonote-worker'],
  ])('Windows에서 WORKER_DATA_DIR %s는 throw한다', (_label, value) => {
    asWindows();
    vi.stubEnv('WORKER_DATA_DIR', value);

    expect(captureError().message).toBe(
      'WORKER_DATA_DIR must be an absolute path (a drive path on Windows)',
    );
  });

  it.each([
    ['누락', undefined, false],
    ['상대 경로', 'docker', false],
    ['Windows에서 .exe 아님', 'C:\\Docker\\docker.cmd', true],
    ['Windows에서 UNC', '\\\\server\\share\\docker.exe', true],
  ])('DOCKER_PATH %s는 값을 드러내지 않고 throw한다', (_label, value, windows) => {
    if (windows) {
      asWindows();
      vi.stubEnv('WORKER_DATA_DIR', 'D:\\echonote-worker');
    }

    vi.stubEnv('DOCKER_PATH', value);

    expect(captureError().message).toBe(
      'DOCKER_PATH must be an absolute path to the docker executable',
    );
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

  it('WORKER_CONCURRENCY를 정수로 읽는다', () => {
    vi.stubEnv('WORKER_CONCURRENCY', '1');

    expect(loadEnvironment().concurrency).toBe(1);
  });

  it.each(['0', '4', '-1', '1.5', 'three', ' 2', ''])(
    'WORKER_CONCURRENCY %j는 throw한다',
    (value) => {
      vi.stubEnv('WORKER_CONCURRENCY', value);

      expect(captureError().message).toBe('WORKER_CONCURRENCY must be an integer from 1 to 3');
    },
  );
});
