import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkDesktopLive } from './desktop-live';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkDesktopLive', () => {
  it('업로드 주소의 origin에 /live를 묻고 204면 true다', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    vi.stubGlobal('fetch', fetchMock);

    expect(await checkDesktopLive('https://desktop.test:8443/v1/uploads/x?y=1')).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://desktop.test:8443/live');
  });

  it('204가 아니거나 요청이 실패하면 false다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    expect(await checkDesktopLive('https://desktop.test/u')).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );

    expect(await checkDesktopLive('https://desktop.test/u')).toBe(false);
  });

  it('https 주소가 아니면 묻지 않고 false다', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    expect(await checkDesktopLive('http://desktop.test/u')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('5초 안에 답이 없으면 끊고 false다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );

    const live = checkDesktopLive('https://desktop.test/u');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await live).toBe(false);
  });
});
