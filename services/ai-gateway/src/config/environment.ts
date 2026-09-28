export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

// HTTP 헤더에 넣을 수 있는 출력 가능 ASCII만 허용한다. new Headers의 TypeError 문구는 값을 담는다.
export const HEADER_SAFE_PATTERN = /^[\x21-\x7e]+$/;

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

  return { supabaseSecretKey, supabaseUrl: url.origin };
};
