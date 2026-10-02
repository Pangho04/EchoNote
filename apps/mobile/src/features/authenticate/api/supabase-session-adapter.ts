import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AUTH_STORAGE_KEY, type AuthStorage } from '@/shared/api/supabase-client';

import type { SessionState } from '../model/session';

type SupabaseAuth = Pick<
  SupabaseClient['auth'],
  | 'getSession'
  | 'onAuthStateChange'
  | 'signInWithPassword'
  | 'signOut'
  | 'startAutoRefresh'
  | 'stopAutoRefresh'
>;

const SIGN_OUT_TIMEOUT_MS = 3_000;

// auth-js가 저장값을 유효 세션으로 보는 필드와 같게 둔다. 다르면 signedIn을 보였다가 곧 로그아웃된다.
const storedSessionSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number(),
  user: z.object({ id: z.string() }),
});

// 로그아웃 신호는 SIGNED_OUT뿐이다. TOKEN_REFRESHED 등을 반영하면 강제 로그아웃 뒤 늦게 끝난 갱신이 로그인 상태를 되살린다.
function toSessionState(event: AuthChangeEvent, session: Session | null): SessionState | null {
  switch (event) {
    case 'SIGNED_IN':
      return session ? { kind: 'signedIn', userId: session.user.id } : null;

    case 'SIGNED_OUT':
      return { kind: 'signedOut', cause: 'expired' };

    case 'INITIAL_SESSION':
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
    case 'PASSWORD_RECOVERY':
    case 'MFA_CHALLENGE_VERIFIED':
      return null;
  }
}

export function createSupabaseSession(auth: SupabaseAuth, storage: AuthStorage) {
  const listeners = new Set<(state: SessionState) => void>();
  let pendingSignOut: Promise<void> = Promise.resolve();

  // 오프라인이면 auth.signOut이 만료 토큰 갱신을 수십 초 시도하고 세션을 남긴다.
  // 그래서 오류나 3초 초과 중 먼저 온 쪽에서 저장값을 직접 지운다. 늦게 끝나는 호출은 그대로 둔다.
  async function signOutWithin3Seconds(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SIGN_OUT_TIMEOUT_MS);
    });
    const signOutResult = auth.signOut({ scope: 'local' }).then(
      ({ error }) => (error ? 'failed' : 'done'),
      () => 'failed' as const,
    );
    const outcome = await Promise.race([signOutResult, timeout]);

    clearTimeout(timer);

    if (outcome === 'done') return;

    try {
      await storage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // 지우지 못하면 다음 실행 때 로그인 상태로 시작할 수 있다. 화면은 이미 로그아웃이라 알릴 곳이 없다.
    }
  }

  return {
    // INITIAL_SESSION은 만료 토큰이면 갱신을 기다리고 오프라인이면 늦게 null을 보내 로그아웃과 구분되지 않는다.
    // 그래서 저장값을 직접 읽는다.
    async restore(): Promise<SessionState> {
      try {
        const stored = await storage.getItem(AUTH_STORAGE_KEY);
        const parsed = storedSessionSchema.safeParse(stored === null ? null : JSON.parse(stored));

        if (parsed.success) return { kind: 'signedIn', userId: parsed.data.user.id };
      } catch {
        // 읽기·JSON 오류는 저장값 없음과 같게 다룬다.
      }

      return { kind: 'signedOut', cause: 'restore' };
    },

    subscribe(listener: (state: SessionState) => void): () => void {
      const {
        data: { subscription },
      } = auth.onAuthStateChange((event, session) => {
        const state = toSessionState(event, session);

        if (state) listener(state);
      });

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        subscription.unsubscribe();
      };
    },

    // 만료가 가까우면 supabase-js가 refresh한 뒤 돌려준다. 실패하면 토큰 없이 보내 Gateway가 401로 판정하게 한다.
    async getAccessToken(): Promise<string | null> {
      try {
        const { data } = await auth.getSession();

        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    },

    // 반환값이 아니라 SIGNED_IN 이벤트로 상태가 전달된다.
    // 진행 중인 로그아웃이 새 세션을 지우지 않도록 그 정리가 끝난 뒤 요청한다.
    async signIn(input: { email: string; password: string }): Promise<void> {
      await pendingSignOut;

      const { error } = await auth.signInWithPassword(input);

      if (error) throw error;
    },

    // 화면을 먼저 로그인으로 바꾸고 라이브러리 정리는 뒤에서 한다. reject하지 않는다.
    signOut(): Promise<void> {
      listeners.forEach((listener) => listener({ kind: 'signedOut', cause: 'user' }));
      pendingSignOut = signOutWithin3Seconds();

      return pendingSignOut;
    },

    startAutoRefresh(): void {
      void auth.startAutoRefresh();
    },

    stopAutoRefresh(): void {
      void auth.stopAutoRefresh();
    },
  };
}

export type SupabaseSession = ReturnType<typeof createSupabaseSession>;
