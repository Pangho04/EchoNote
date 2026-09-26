import { describe, expect, it, vi } from 'vitest';

import { createSupabaseSession } from './supabase-session-adapter';

function buildFakeAuth() {
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn((_callback: (event: string, session: unknown) => void) => ({
    data: { subscription: { unsubscribe } },
  }));
  const signInWithPassword = vi.fn<() => Promise<{ error: Error | null }>>(async () => ({
    error: null,
  }));
  const signOut = vi.fn<() => Promise<{ error: Error | null }>>(async () => ({ error: null }));
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

describe('createSupabaseSession', () => {
  describe('subscribe', () => {
    it('INITIAL_SESSION에 session이 있으면 signedIn으로 알린다', () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );
      const listener = vi.fn();

      session.subscribe(listener);
      auth.onAuthStateChange.mock.calls[0]![0]('INITIAL_SESSION', { user: { id: 'user-1' } });

      expect(listener).toHaveBeenCalledWith({ kind: 'signedIn', userId: 'user-1' });
    });

    it('INITIAL_SESSION이 null이면 signedOut으로 알린다', () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );
      const listener = vi.fn();

      session.subscribe(listener);
      auth.onAuthStateChange.mock.calls[0]![0]('INITIAL_SESSION', null);

      expect(listener).toHaveBeenCalledWith({ kind: 'signedOut' });
    });

    it('SIGNED_OUT 이벤트에서 session이 null이면 signedOut으로 알린다', () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );
      const listener = vi.fn();

      session.subscribe(listener);
      auth.onAuthStateChange.mock.calls[0]![0]('SIGNED_OUT', null);

      expect(listener).toHaveBeenCalledWith({ kind: 'signedOut' });
    });

    it('반환한 함수를 부르면 subscription.unsubscribe를 부른다', () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );
      const unsubscribe = session.subscribe(vi.fn());

      unsubscribe();

      expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('signIn', () => {
    it('email·password를 그대로 전달하고 error가 없으면 resolve한다', async () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(
        session.signIn({ email: 'user@example.com', password: 'password-1' }),
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

      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(
        session.signIn({ email: 'user@example.com', password: 'password-1' }),
      ).rejects.toThrow('Invalid login credentials');
    });
  });

  describe('signOut', () => {
    it('auth.signOut이 error를 반환해도 resolve한다', async () => {
      const auth = buildFakeAuth();

      auth.signOut.mockResolvedValueOnce({ error: new Error('network') });

      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(session.signOut()).resolves.toBeUndefined();
    });
  });

  describe('getAccessToken', () => {
    it('session에 access_token이 있으면 그대로 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });

      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(session.getAccessToken()).resolves.toBe('tok');
    });

    it('session이 null이면 null을 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockResolvedValueOnce({ data: { session: null } });

      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(session.getAccessToken()).resolves.toBeNull();
    });

    it('getSession이 reject하면 null을 반환한다', async () => {
      const auth = buildFakeAuth();

      auth.getSession.mockRejectedValueOnce(new Error('network'));

      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      await expect(session.getAccessToken()).resolves.toBeNull();
    });
  });

  describe('startAutoRefresh·stopAutoRefresh', () => {
    it('auth의 대응 메서드에 위임한다', () => {
      const auth = buildFakeAuth();
      const session = createSupabaseSession(
        auth as unknown as Parameters<typeof createSupabaseSession>[0],
      );

      session.startAutoRefresh();
      session.stopAutoRefresh();

      expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
      expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
