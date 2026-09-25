import type { SupabaseClient } from '@supabase/supabase-js';

import type { SessionState } from '../model/session';

type SupabaseAuth = Pick<
  SupabaseClient['auth'],
  'onAuthStateChange' | 'signInWithPassword' | 'signOut' | 'startAutoRefresh' | 'stopAutoRefresh'
>;

export function createSupabaseSession(auth: SupabaseAuth) {
  return {
    // supabase-js는 subscribe할 때마다 INITIAL_SESSION 이벤트를 보낸다(저장된 session, 복원 실패 시 null).
    // 그래서 별도 복원 호출이 필요 없다.
    subscribe(listener: (state: SessionState) => void): () => void {
      const {
        data: { subscription },
      } = auth.onAuthStateChange((_event, session) => {
        listener(session ? { kind: 'signedIn', userId: session.user.id } : { kind: 'signedOut' });
      });

      return () => subscription.unsubscribe();
    },

    // 반환값이 아니라 SIGNED_IN 이벤트로 상태가 전달된다.
    async signIn(input: { email: string; password: string }): Promise<void> {
      const { error } = await auth.signInWithPassword(input);

      if (error) throw error;
    },

    // supabase-js는 서버 호출이 실패해도(예: 오프라인) 로컬 session을 지우고 SIGNED_OUT을 보낸다.
    // 그래서 오류를 밖으로 드러내지 않는다.
    async signOut(): Promise<void> {
      await auth.signOut();
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
