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

// signedOut이 연달아 오면 이전 객체를 유지해 만료 팝업 등 상태 변화 반응이 다시 돌지 않게 한다.
// 복원 중 만료는 로그인한 적이 없으므로 복원 실패로 바꾼다.
function applyNotification(previous: SessionView, next: SessionState): SessionView {
  if (previous.kind === 'signedOut' && next.kind === 'signedOut') return previous;

  if (previous.kind === 'restoring' && next.kind === 'signedOut' && next.cause === 'expired')
    return { kind: 'signedOut', cause: 'restore' };

  return next;
}

export interface SessionProviderProps {
  session: SupabaseSession;
  children: ReactNode;
}

export function SessionProvider({ session, children }: SessionProviderProps) {
  const [state, setState] = useState<SessionView>({ kind: 'restoring' });

  /**
   * @when 앱 시작 시 session을 받으면
   * @expect 구독 + 복원. 복원 결과는 아직 restoring일 때만 반영해 먼저 온 로그인·로그아웃·만료 알림을 보존한다
   * @clear auth 이벤트 구독 해제
   */
  useEffect(() => {
    const unsubscribe = session.subscribe((next) =>
      setState((previous) => applyNotification(previous, next)),
    );

    void session
      .restore()
      .then((restored) =>
        setState((previous) => (previous.kind === 'restoring' ? restored : previous)),
      );

    return unsubscribe;
  }, [session]);

  /**
   * @when state.kind가 바뀔 때마다
   * @expect signedIn이 아니면 자동 갱신을 즉시 끈다. 로그아웃이 지운 저장값을 갱신이 다시 쓰지 않게 한다.
   *   signedIn이면 foreground일 때 켜고 background로 가면 끈다
   * @clear (signedIn일 때만) AppState 구독 해제와 자동 갱신 중지
   */
  useEffect(() => {
    if (state.kind !== 'signedIn') {
      session.stopAutoRefresh();

      return;
    }

    if (AppState.currentState === 'active') session.startAutoRefresh();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') session.startAutoRefresh();
      else session.stopAutoRefresh();
    });

    return () => {
      subscription.remove();
      session.stopAutoRefresh();
    };
  }, [session, state.kind]);

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
