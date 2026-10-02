import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { AppState } from 'react-native';

import type { SessionState } from './session';
import { SessionProvider, useSession } from './session-provider';

function buildFakeSession() {
  let resolveRestore: (state: SessionState) => void = () => {};

  return {
    subscribe: jest.fn((_listener: (state: SessionState) => void) => jest.fn()),
    restore: jest.fn(
      () =>
        new Promise<SessionState>((resolve) => {
          resolveRestore = resolve;
        }),
    ),
    resolveRestore: (state: SessionState) => resolveRestore(state),
    signIn: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  };
}

describe('SessionProvider', () => {
  // AppState.addEventListener는 jest-expo가 이미 jest.fn()으로 만들어 둔다. 매번 비우지 않으면
  // 이전 테스트에서 등록한 handler가 mock.calls에 남아 이번 테스트의 handler로 잘못 읽힌다.
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  });

  it('restoring 중엔 자동 갱신을 켜지 않고 signedIn이면 켜고 signedOut이면 끈 뒤 foreground 감시도 해제한다', async () => {
    const session = buildFakeSession();
    const removeMock = jest.fn();
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: removeMock } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    const listener = session.subscribe.mock.calls[0]![0];

    expect(result.current.state).toEqual({ kind: 'restoring' });
    expect(session.startAutoRefresh).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalled();

    await act(async () => {
      listener({ kind: 'signedIn', userId: 'user-1' });
    });

    expect(session.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener({ kind: 'signedOut', cause: 'user' });
    });

    // 마운트 시 restoring 분기에서 1회, signedOut 전환 시 signedIn effect의 cleanup과
    // signedOut 분기에서 각 1회씩, 총 3회 stopAutoRefresh가 불린다.
    expect(session.stopAutoRefresh).toHaveBeenCalledTimes(3);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(session.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('signedOut 상태가 되면 stopAutoRefresh를 부르고 startAutoRefresh는 부르지 않는다', async () => {
    const session = buildFakeSession();

    await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    session.stopAutoRefresh.mockClear();
    await act(async () => {
      session.resolveRestore({ kind: 'signedOut', cause: 'restore' });
    });

    expect(session.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(session.startAutoRefresh).not.toHaveBeenCalled();
  });

  it('signedOut 중에는 AppState를 구독하지 않고 startAutoRefresh를 부르지 않는다', async () => {
    const session = buildFakeSession();
    const addEventListenerSpy = jest.spyOn(AppState, 'addEventListener');

    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });

    await act(async () => {
      session.resolveRestore({ kind: 'signedOut', cause: 'restore' });
    });

    expect(result.current.state).toEqual({ kind: 'signedOut', cause: 'restore' });
    expect(addEventListenerSpy).not.toHaveBeenCalled();
    expect(session.startAutoRefresh).not.toHaveBeenCalled();
  });

  it('subscribe listener가 부르면 state가 갱신된다', async () => {
    const session = buildFakeSession();
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    const listener = session.subscribe.mock.calls[0]![0];

    await act(async () => {
      listener({ kind: 'signedIn', userId: 'user-1' });
    });

    expect(result.current.state).toEqual({ kind: 'signedIn', userId: 'user-1' });
  });

  it('AppState가 background로 가면 stopAutoRefresh, 다시 active면 startAutoRefresh를 부른다', async () => {
    const session = buildFakeSession();
    const addEventListenerSpy = jest.spyOn(AppState, 'addEventListener');

    await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    await act(async () => {
      session.resolveRestore({ kind: 'signedIn', userId: 'user-1' });
    });

    const handler = addEventListenerSpy.mock.calls[0]![1];

    await act(async () => {
      handler('background');
    });

    // restoring 분기에서 마운트 시 1회, background 전환 시 1회, 총 2회다.
    expect(session.stopAutoRefresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      handler('active');
    });

    expect(session.startAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('unmount 시 구독 해제와 AppState 정리, auto refresh 중지를 한다', async () => {
    const session = buildFakeSession();
    const unsubscribe = jest.fn();

    session.subscribe.mockReturnValue(unsubscribe);

    const removeMock = jest.fn();

    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: removeMock } as never);

    const { unmount } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });

    await act(async () => {
      session.resolveRestore({ kind: 'signedIn', userId: 'user-1' });
    });
    session.stopAutoRefresh.mockClear();
    await act(async () => {
      unmount();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(session.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('restoring 중 restore 결과를 반영한다', async () => {
    const signedIn = buildFakeSession();
    const signedOut = buildFakeSession();
    const first = await renderHook(() => useSession(), { wrapper: wrapperFor(signedIn) });
    const second = await renderHook(() => useSession(), { wrapper: wrapperFor(signedOut) });

    await act(async () => {
      signedIn.resolveRestore({ kind: 'signedIn', userId: 'user-1' });
      signedOut.resolveRestore({ kind: 'signedOut', cause: 'restore' });
    });

    expect(first.result.current.state).toEqual({ kind: 'signedIn', userId: 'user-1' });
    expect(second.result.current.state).toEqual({ kind: 'signedOut', cause: 'restore' });
  });

  it('restore보다 먼저 온 SIGNED_IN을 유지하고 늦은 restore 결과는 무시한다', async () => {
    const session = buildFakeSession();
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    const listener = session.subscribe.mock.calls[0]![0];

    await act(async () => {
      listener({ kind: 'signedIn', userId: 'user-1' });
    });
    await act(async () => {
      session.resolveRestore({ kind: 'signedOut', cause: 'restore' });
    });

    expect(result.current.state).toEqual({ kind: 'signedIn', userId: 'user-1' });
  });

  it('restoring 중 만료 알림은 cause restore로 반영하고 늦은 restore 결과는 무시한다', async () => {
    const session = buildFakeSession();
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    const listener = session.subscribe.mock.calls[0]![0];

    await act(async () => {
      listener({ kind: 'signedOut', cause: 'expired' });
    });

    expect(result.current.state).toEqual({ kind: 'signedOut', cause: 'restore' });

    await act(async () => {
      session.resolveRestore({ kind: 'signedIn', userId: 'user-1' });
    });

    expect(result.current.state).toEqual({ kind: 'signedOut', cause: 'restore' });
  });

  it('signedOut 중 signedOut 알림이 오면 같은 상태 객체를 유지한다', async () => {
    const session = buildFakeSession();
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });
    const listener = session.subscribe.mock.calls[0]![0];

    await act(async () => {
      listener({ kind: 'signedOut', cause: 'user' });
    });

    const previous = result.current.state;

    await act(async () => {
      listener({ kind: 'signedOut', cause: 'expired' });
    });

    expect(result.current.state).toBe(previous);
    expect(result.current.state).toEqual({ kind: 'signedOut', cause: 'user' });
  });

  it('SessionProvider 밖에서 useSession을 부르면 오류를 던진다', async () => {
    await expect(renderHook(() => useSession())).rejects.toThrow(
      'useSession must be used inside SessionProvider',
    );
  });
});

function wrapperFor(session: ReturnType<typeof buildFakeSession>) {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <SessionProvider session={session as never}>{children}</SessionProvider>;
  };
}
