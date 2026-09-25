// EXPO_PUBLIC_ 값은 앱 번들에 그대로 포함된다. URL·publishable key처럼 공개해도 되는 값만 두고
// 서버 전용 secret key는 여기 두지 않는다.

function readEnv(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(`${name} is not set. Copy apps/mobile/.env.example to apps/mobile/.env.local.`);

  return value;
}

// Expo는 `process.env.EXPO_PUBLIC_*` 형태의 리터럴 member access만 번들 시점에 치환한다.
// 변수로 key를 만들면 치환되지 않으므로 각 값을 직접 읽는다.
export const SUPABASE_URL = readEnv(
  'EXPO_PUBLIC_SUPABASE_URL',
  process.env.EXPO_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = readEnv(
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
