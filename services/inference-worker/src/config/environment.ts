import { isAbsolute } from 'node:path';

const MIN_UPLOAD_GRANT_SECRET_BYTES = 32;
const DEFAULT_WORKER_PORT = 4318;

const loadUploadGrantSecret = () => {
  // trim하지 않는다. 앞뒤 공백·줄바꿈이 붙은 값도 설정 실수로 보고 아래 검사에서 거부한다.
  const encoded = process.env.UPLOAD_GRANT_SECRET_B64 ?? '';
  const decoded = Buffer.from(encoded, 'base64');

  // Buffer.from은 alphabet 밖 문자·공백을 버리고 padding 누락·URL-safe 문자도 받아들이므로,
  // 다시 표준 Base64로 encode한 결과가 입력과 같아야 한다.
  if (decoded.toString('base64') !== encoded || decoded.length < MIN_UPLOAD_GRANT_SECRET_BYTES) {
    throw new Error(
      `UPLOAD_GRANT_SECRET_B64 must be standard Base64 of at least ${MIN_UPLOAD_GRANT_SECRET_BYTES} bytes`,
    );
  }

  return new Uint8Array(decoded);
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

// 오류 문구에 입력값을 넣지 않는다. 시작 실패 로그에 secret·경로가 남지 않게 한다.
export const loadEnvironment = () => {
  const dataDir = process.env.WORKER_DATA_DIR;

  // 저장소 밖인지는 검사하지 않는다. .env.example 안내로 맡긴다.
  if (dataDir === undefined || !isAbsolute(dataDir)) {
    throw new Error('WORKER_DATA_DIR must be an absolute path');
  }

  return {
    dataDir,
    port: loadWorkerPort(),
    uploadGrantSecret: loadUploadGrantSecret(),
  };
};
