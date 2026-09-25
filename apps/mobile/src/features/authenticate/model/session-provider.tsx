import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import type { SupabaseSession } from '../api/supabase-session-adapter';
import type { SessionState } from './session';

export type SessionView = { kind: 'restoring' } | SessionState;

interface SessionContextValue {
  state: SessionView;
  signIn(input: { email: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  session: SupabaseSession;
  children: ReactNode;
}

export function SessionProvider({ session, children }: SessionProviderProps) {
  const [state, setState] = useState<SessionView>({ kind: 'restoring' });

  /**
   * @when 앱 시작 시 session을 받으면
   * @expect 저장된 session 복원 결과와 이후 로그인·로그아웃·만료를 상태로 반영
   * @clear auth 이벤트 구독 해제
   */
  useEffect(() => {
    return session.subscribe(setState);
  }, [session]);

  /**
   * @when 앱이 foreground에 있는 동안
   * @expect token 자동 갱신을 실행하고, background로 가면 멈춰 불필요한 요청을 막는다
   * @clear 이벤트 구독 해제와 auto refresh 중지
   */
  useEffect(() => {
    if (AppState.currentState === 'active') session.startAutoRefresh();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') session.startAutoRefresh();
      else session.stopAutoRefresh();
    });

    return () => {
      subscription.remove();
      session.stopAutoRefresh();
    };
  }, [session]);

  const value = useMemo<SessionContextValue>(
    () => ({ state, signIn: session.signIn, signOut: session.signOut }),
    [state, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);

  if (!value) throw new Error('useSession must be used inside SessionProvider');

  return value;
}
