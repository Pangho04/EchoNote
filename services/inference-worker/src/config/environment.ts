import { isAbsolute } from 'node:path';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);
const MIN_SECRET_BYTES = 32;
const DEFAULT_WORKER_PORT = 4318;
// Windows에서는 드라이브 경로만 받는다. UNC 공유 경로는 docker bind 대상으로 쓰지 않는다.
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

// 검사를 통과한 Base64 원문을 돌려준다.
const loadBase64Secret = (name: string) => {
  // trim하지 않는다. 앞뒤 공백·줄바꿈이 붙은 값도 설정 실수로 보고 아래 검사에서 거부한다.
  const encoded = process.env[name] ?? '';
  const decoded = Buffer.from(encoded, 'base64');

  // Buffer.from은 alphabet 밖 문자·공백을 버리고 padding 누락·URL-safe 문자도 받아들이므로,
  // 다시 표준 Base64로 encode한 결과가 입력과 같아야 한다.
  if (decoded.toString('base64') !== encoded || decoded.length < MIN_SECRET_BYTES) {
    throw new Error(`${name} must be standard Base64 of at least ${MIN_SECRET_BYTES} bytes`);
  }

  return encoded;
};

// Worker token을 담은 완료 통지가 향할 곳이다.
const loadGatewayOrigin = () => {
  const gatewayUrl = process.env.GATEWAY_BASE_URL;

  if (gatewayUrl === undefined || !URL.canParse(gatewayUrl)) {
    throw new Error('GATEWAY_BASE_URL must be an absolute URL');
  }

  const url = new URL(gatewayUrl);
  const isLocalHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

  // path·query·hash·userinfo가 붙은 값은 설정 실수로 보고 거부한다.
  if ((url.protocol !== 'https:' && !isLocalHttp) || url.href !== `${url.origin}/`) {
    throw new Error(
      'GATEWAY_BASE_URL must be an https origin without path, query, hash or userinfo (http is allowed only for localhost)',
    );
  }

  return url.origin;
};

const loadWorkerPort = () => {
  const raw = process.env.ECHONOTE_WORKER_PORT;

  if (raw === undefined) return DEFAULT_WORKER_PORT;

  const port = Number(raw);

  if (!/^\d+$/.test(raw) || port < 1 || port > 65_535) {
    throw new Error('ECHONOTE_WORKER_PORT must be an integer from 1 to 65535');
  }

  return port;
};

const isPlatformAbsolute = (path: string) =>
  process.platform === 'win32' ? WINDOWS_DRIVE_PATH.test(path) : isAbsolute(path);

// shell 없이 실행하므로 PATH 검색에 기대지 않고 실행 파일을 직접 가리킨다.
const loadDockerPath = () => {
  const dockerPath = process.env.DOCKER_PATH;

  if (
    dockerPath === undefined ||
    !isPlatformAbsolute(dockerPath) ||
    (process.platform === 'win32' && !/\.exe$/i.test(dockerPath))
  ) {
    throw new Error('DOCKER_PATH must be an absolute path to the docker executable');
  }

  return dockerPath;
};

// 오류 문구에 입력값을 넣지 않는다. 시작 실패 로그에 secret·경로·URL이 남지 않게 한다.
export const loadEnvironment = () => {
  const dataDir = process.env.WORKER_DATA_DIR;

  // 저장소 밖인지는 검사하지 않는다. .env.example 안내로 맡긴다.
  if (dataDir === undefined || !isPlatformAbsolute(dataDir)) {
    throw new Error('WORKER_DATA_DIR must be an absolute path (a drive path on Windows)');
  }

  // docker --mount 값은 ','로 항목을 나눈다.
  if (dataDir.includes(',')) throw new Error('WORKER_DATA_DIR must not contain a comma');

  const uploadGrantSecret = loadBase64Secret('UPLOAD_GRANT_SECRET_B64');
  const workerApiToken = loadBase64Secret('WORKER_API_TOKEN');

  // 한 값이 새면 grant 위조와 완료 통지 위조가 함께 열린다.
  if (workerApiToken === uploadGrantSecret) {
    throw new Error('WORKER_API_TOKEN must differ from UPLOAD_GRANT_SECRET_B64');
  }

  return {
    dataDir,
    dockerPath: loadDockerPath(),
    gatewayOrigin: loadGatewayOrigin(),
    port: loadWorkerPort(),
    uploadGrantSecret: new Uint8Array(Buffer.from(uploadGrantSecret, 'base64')),
    workerApiToken,
  };
};
