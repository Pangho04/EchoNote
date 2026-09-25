import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { AppState } from 'react-native';

import type { SessionState } from './session';
import { SessionProvider, useSession } from './session-provider';

function buildFakeSession() {
  return {
    subscribe: jest.fn((_listener: (state: SessionState) => void) => jest.fn()),
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

  it('초기 상태는 restoring이고 mount 시 foreground면 startAutoRefresh를 한 번 부른다', async () => {
    const session = buildFakeSession();
    const { result } = await renderHook(() => useSession(), { wrapper: wrapperFor(session) });

    expect(result.current.state).toEqual({ kind: 'restoring' });
    expect(session.startAutoRefresh).toHaveBeenCalledTimes(1);
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

    const handler = addEventListenerSpy.mock.calls[0]![1];

    await act(async () => {
      handler('background');
    });

    expect(session.stopAutoRefresh).toHaveBeenCalledTimes(1);

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
      unmount();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(session.stopAutoRefresh).toHaveBeenCalled();
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
