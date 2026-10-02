// RN에는 supabase-js가 요구하는 완전한 URL 구현이 없다. supabase-js보다 먼저 로드해야 한다.
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/shared/config/env';

// 기기 보안 저장소처럼 문자열만 보관하는 저장소. 토큰의 의미는 모른다.
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const AUTH_STORAGE_KEY = 'echonote-auth';

export function createMobileSupabaseClient(storage: AuthStorage) {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
