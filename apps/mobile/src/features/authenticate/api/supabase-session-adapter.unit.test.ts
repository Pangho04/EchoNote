import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseSession } from './supabase-session-adapter';

vi.hoisted(() => {
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
  vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', 'http://127.0.0.1:4317');
});

vi.mock('react-native-url-polyfill/auto', () => ({}));

const STORED_SESSION = JSON.stringify({
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: 1_900_000_000,
  user: { id: 'user-1' },
});

function buildFakeAuth() {
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn((_callback: (event: string, session: unknown) => void) => ({
    data: { subscription: { unsubscribe } },
  }));
  const signInWithPassword = vi.fn<() => Promise<{ error: Error | null }>>(async () => ({
    error: null,
  }));
  const signOut = vi.fn<(options: { scope: string }) => Promise<{ error: Error | null }>>(
    async () => ({ error: null }),
  );
  const getSession = vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>(
    async () => ({ data: { session: null } }),
  );

  return {
    unsubscribe,
    onAuthStateChange,
    signInWithPassword,
    signOut,
    getSession,
    startAutoRefresh: vi.fn(async () => {}),
    stopAutoRefresh: vi.fn(async () => {}),
  };
}

function buildFakeStorage() {
  return {
    getItem: vi.fn<(key: string) => Promise<string | null>>(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn<(key: string) => Promise<void>>(async () => {}),
  };
}

function createSession(auth: ReturnType<typeof buildFakeAuth>, storage = buildFakeStorage()) {
  return createSupabaseSession(
    auth as unknown as Parameters<typeof createSupabaseSession>[0],
    storage,
  );
}

function emit(auth: ReturnType<typeof buildFakeAuth>, event: string, session: unknown) {
  auth.onAuthStateChange.mock.calls[0]![0](event, session);
}

describe('createSupabaseSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('restore', () => {
    it('저장값이 유효하면 signedIn으로 돌려준다', async () => {
      const storage = buildFakeStorage();

      storage.getItem.mockResolvedValueOnce(STORED_SESSION);

      await expect(createSession(buildFakeAuth(), storage).restore()).resolves.toEqual({
        kind: 'signedIn',
        userId: 'user-1',
      });
      expect(storage.getItem).toHaveBeenCalledWith('echonote-auth');
    });

    it('저장값이 없으면 signedOut(restore)', async () => {
      await expect(createSession(buildFakeAuth()).restore()).resolves.toEqual({
        kind: 'signedOut',
        cause: 'restore',
      });
    });

    it('필드가 빠졌거나 JSON이 아니면 signedOut(restore)', async () => {
      const storage = buildFakeStorage();
      const session = createSession(buildFakeAuth(), storage);

      storage.getItem.mockResolvedValueOnce(
        JSON.stringify({ access_token: 'access', user: { id: 'user-1' } }),
      );
      storage.getItem.mockResolvedValueOnce('not-json');

      await expect(session.restore()).resolves.toEqual({ kind: 'signedOut', cause: 'restore' });
      await expect(session.restore()).resolves.toEqual({ kind: 'signedOut', cause: 'restore' });
    });

    it('저장소 읽기가 reject하면 signedOut(restore)', async () => {
      const storage = buildFakeStorage();

      storage.getItem.mockRejectedValueOnce(new Error('keychain'));

      await expect(createSession(buildFakeAuth(), storage).restore()).resolves.toEqual({
        kind: 'signedOut',
        cause: 'restore',
      });
    });
  });

  describe('subscribe', () => {
    it('SIGNED_IN이면 signedIn으로 알리고 signedIn 중 재수신해도 signedIn으로 알린다', () => {
      const auth = buildFakeAuth();
      const listener = vi.fn();

      createSession(auth).subscribe(listener);
      emit(auth, 'SIGNED_IN', { user: { id: 'user-1' } });
      emit(auth, 'SIGNED_IN', { user: { id: 'user-1' } });

      expect(listener).toHaveBeenNthCalledWith(1, { kind: 'signedIn', userId: 'user-1' });
      expect(listener).toHaveBeenNthCalledWith(2, { kind: 'signedIn', userId: 'user-1' });
    });

    it('SIGNED_OUT은 항상 signedOut(expired)로 알린다', () => {
      const auth = buildFakeAuth();
      const listener = vi.fn();

      createSession(auth).subscribe(listener);
      emit(auth, 'SIGNED_OUT', null);

      expect(listener).toHaveBeenCalledWith({ kind: 'signedOut', cause: 'expired' });
    });

    it.each([
      ['INITIAL_SESSION', { user: { id: 'user-1' } }],
      ['INITIAL_SESSION', null],
      ['TOKEN_REFRESHED', { user: { id: 'user-1' } }],
      ['USER_UPDATED', { user: { id: 'user-1' } }],
      ['PASSWORD_RECOVERY', { user: { id: 'user-1' } }],
      ['MFA_CHALLENGE_VERIFIED', { user: { id: 'user-1' } }],
    ])('%s는 session 유무와 무관하게 알리지 않는다', (event, payload) => {
      const auth = buildFakeAuth();
      const listener = vi.fn();

      createSession(auth).subscribe(listener);
      emit(auth, event, payload);

      expect(listener).not.toHaveBeenCalled();
    });

    it('반환한 함수를 부르면 subscription.unsubscribe를 부르고 강제 알림도 받지 않는다', () => {
      const auth = buildFakeAuth();
      const session = createSession(auth);
      const listener = vi.fn();
      const unsubscribe = session.subscribe(listener);

      unsubscribe();
      void session.signOut();

      expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    it('email·password를 그대로 전달하고 error가 없으면 resolve한다', async () => {
      const auth = buildFakeAuth();

      await expect(
        createSession(auth).signIn({ email: 'user@example.com', password: 'password-1' }),
      ).resolves.toBeUndefined();

      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password-1',
      });
    });

    it('signInWithPassword가 error를 반환하면 reject한다', async () => {
      const auth = buildFakeAuth();

      auth.signInWithPassword.mockResolvedValueOnce({
        error: new Error('Invalid login credentials'),
      });

      await expect(
        createSession(auth).signIn({ email: 'user@example.com', password: 'password-1' }),
      ).rejects.toThrow('Invalid login credentials');
    });

    it('진행 중인 로그아웃이 끝난 뒤 로그인을 요청한다', async () => {
      const auth = buildFakeAuth();
      let finishSignOut: (result: { error: Error | null }) => void = () => {};

      auth.signOut.mockReturnValueOnce(
        new Promise((resolve) => {
          finishSignOut = resolve;
        }),
      );

      const session = createSession(auth);

      void session.signOut();

      const signingIn = session.signIn({ email: 'user@example.com', password: 'password-1' });

      await Promise.resolve();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();

      finishSignOut({ error: null });
      await signingIn;

      expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    });

    it('로그아웃이 3초 넘게 끝나지 않으면 3초에 로그인을 요청한다', async () => {
      vi.useFakeTimers();

      const auth = buildFakeAuth();

      auth.signOut.mockReturnValueOnce(new Promise(() => {}));

      const session = createSession(auth);

      void session.signOut();

      const signingIn = session.signIn({ email: 'user@example.com', password: 'password-1' });

      await vi.advanceTimersByTimeAsync(2_999);
      expect(auth.signInWithPassword).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await signingIn;

      expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    });
  });

  describe('signOut', () => {
    it('signedOut(user)을 먼저 알린 뒤 local scope로 signOut하고, 정상 종료면 키를 지우지 않는다', async () => {
      vi.useFakeTimers();

      const auth = buildFakeAuth();
      const storage = buildFakeStorage();
      const session = createSession(auth, storage);
      const listener = vi.fn();

      session.subscribe(listener);
      await session.signOut();
      emit(auth, 'SIGNED_OUT', null);
      await vi.advanceTimersByTimeAsync(3_000);

      expect(listener.mock.calls).toEqual([
        [{ kind: 'signedOut', cause: 'user' }],
        [{ kind: 'signedOut', cause: 'expired' }],
      ]);
      expect(listener.mock.invocationCallOrder[0]).toBeLessThan(
        auth.signOut.mock.invocationCallOrder[0]!,
      );
      expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('signOut이 error를 반환하면 키를 지우고 추가 알림은 없다', async () => {
      const auth = buildFakeAuth();
      const storage = buildFakeStorage();
      const session = createSession(auth, storage);
      const listener = vi.fn();

      auth.signOut.mockResolvedValueOnce({ error: new Error('network') });
      session.subscribe(listener);

      await expect(session.signOut()).resolves.toBeUndefined();

      expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith('echonote-auth');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('signOut 호출 시작부터 3초가 지나면 키를 1회 지우고 늦은 정상 종료엔 아무것도 하지 않는다', async () => {
      vi.useFakeTimers();

      const auth = buildFakeAuth();
      const storage = buildFakeStorage();
      let finishSignOut: (result: { error: Error | null }) => void = () => {};

      auth.signOut.mockReturnValueOnce(
        new Promise((resolve) => {
          finishSignOut = resolve;
        }),
      );

      const signingOut = createSession(auth, storage).signOut();

      await vi.advanceTimersByTimeAsync(2_999);
      expect(storage.removeItem).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await signingOut;
      expect(storage.removeItem).toHaveBeenCalledTimes(1);

      finishSignOut({ error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(storage.removeItem).toHaveBeenCalledTimes(1);
    });

    it('키 삭제가 reject해도 호출자에 reject하지 않는다', async () => {
      const auth = buildFakeAuth();
      const storage = buildFakeStorage();

      auth.signOut.mockResolvedValueOnce({ error: new Error('network') });
      storage.removeItem.mockRejectedValueOnce(new Error('keychain'));

      await expect(createSession(auth, storage).signOut()).resolves.toBeUndefined();
    });
  });

  describe('getAccessToken', () => {
    it('session에 access_token이 있으면 그대로 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });

      await expect(createSession(auth).getAccessToken()).resolves.toBe('tok');
    });

    it('session이 null이면 null을 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockResolvedValueOnce({ data: { session: null } });

      await expect(createSession(auth).getAccessToken()).resolves.toBeNull();
    });

    it('getSession이 reject하면 null을 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockRejectedValueOnce(new Error('network'));

      await expect(createSession(auth).getAccessToken()).resolves.toBeNull();
    });
  });

  describe('startAutoRefresh·stopAutoRefresh', () => {
    it('auth의 대응 메서드에 위임한다', () => {
      const auth = buildFakeAuth();
      const session = createSession(auth);

      session.startAutoRefresh();
      session.stopAutoRefresh();

      expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
      expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
