const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

// 오류 문구에 입력값을 넣지 않는다. 시작 실패 로그에 URL이 남지 않게 한다.
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

  return { supabaseUrl: url.origin };
};
