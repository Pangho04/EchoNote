const LIVE_TIMEOUT_MS = 5_000;

// Worker는 업로드 주소와 같은 서버에서 /live를 연다. Gateway 토큰을 붙이지 않으려고 axios 대신 fetch를 쓴다.
export async function checkDesktopLive(uploadUrl: string): Promise<boolean> {
  const origin = /^https:\/\/[^/?#]+/.exec(uploadUrl)?.[0];

  if (!origin) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);

  try {
    const response = await fetch(`${origin}/live`, { signal: controller.signal });

    return response.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
