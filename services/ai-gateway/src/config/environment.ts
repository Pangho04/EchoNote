export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

// HTTP 헤더에 넣을 수 있는 출력 가능 ASCII만 허용한다. new Headers의 TypeError 문구는 값을 담는다.
export const HEADER_SAFE_PATTERN = /^[\x21-\x7e]+$/;

const MIN_UPLOAD_GRANT_SECRET_BYTES = 32;

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

// grant를 담은 요청이 향할 곳이다.
const loadWorkerReceiverOrigin = () => {
  const receiverUrl = process.env.WORKER_RECEIVER_BASE_URL;

  if (receiverUrl === undefined || !URL.canParse(receiverUrl)) {
    throw new Error('WORKER_RECEIVER_BASE_URL must be an absolute URL');
  }

  const url = new URL(receiverUrl);

  // path·query·hash·userinfo가 붙은 값은 설정 실수로 보고 거부한다.
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) {
    throw new Error(
      'WORKER_RECEIVER_BASE_URL must be an https origin without path, query, hash or userinfo',
    );
  }

  return url.origin;
};

// 오류 문구에 입력값을 넣지 않는다. 시작 실패 로그에 URL·key가 남지 않게 한다.
export const loadEnvironment = () => {
  const supabaseUrl = process.env.SUPABASE_URL;

  if (supabaseUrl === undefined || !URL.canParse(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be an absolute URL');
  }

  const url = new URL(supabaseUrl);
  const isLocalHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('SUPABASE_URL must use https (http is allowed only for localhost)');
  }

  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? '';

  if (!HEADER_SAFE_PATTERN.test(supabaseSecretKey)) {
    throw new Error('SUPABASE_SECRET_KEY must be set to printable ASCII without spaces');
  }

  return {
    supabaseSecretKey,
    supabaseUrl: url.origin,
    uploadGrantSecret: loadUploadGrantSecret(),
    workerReceiverOrigin: loadWorkerReceiverOrigin(),
  };
};
