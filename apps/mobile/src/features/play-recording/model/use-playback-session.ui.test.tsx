import { act, renderHook } from '@testing-library/react-native';

import {
  type AudioPlayback,
  type AudioPlaybackStatus,
  PlaybackStatusKind,
} from '../api/audio-playback';
import { formatClockLabel, usePlaybackSession } from './use-playback-session';

function buildPlayback(overrides: Partial<AudioPlaybackStatus> = {}): AudioPlayback {
  const status: AudioPlaybackStatus = {
    kind: PlaybackStatusKind.READY,
    positionMs: 20_000,
    durationMs: 60_000,
    ...overrides,
  };

  return {
    status,
    getPositionMs: jest.fn(() => status.positionMs),
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => {}),
  };
}

describe('formatClockLabel', () => {
  it.each([
    [null, '--:--'],
    [0, '0:00'],
    [59_999, '0:59'],
    [61_000, '1:01'],
    [3_134_000, '52:14'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
  ])('%s → %s', (ms, label) => {
    expect(formatClockLabel(ms)).toBe(label);
  });
});

describe('usePlaybackSession', () => {
  it.each([
    [PlaybackStatusKind.LOADING, { canPlay: false, canPause: false, canSeek: false }],
    [PlaybackStatusKind.READY, { canPlay: true, canPause: false, canSeek: true }],
    [PlaybackStatusKind.PLAYING, { canPlay: false, canPause: true, canSeek: true }],
    [PlaybackStatusKind.ENDED, { canPlay: true, canPause: false, canSeek: true }],
    [PlaybackStatusKind.ERROR, { canPlay: false, canPause: false, canSeek: false }],
  ])('kind %s의 버튼 활성 상태', async (kind, expected) => {
    const { result } = await renderHook(() => usePlaybackSession(buildPlayback({ kind })));

    expect(result.current).toEqual(expect.objectContaining({ status: kind, ...expected }));
  });

  it('길이를 모르면 seek를 막고 label은 --:--다', async () => {
    const { result } = await renderHook(() =>
      usePlaybackSession(buildPlayback({ durationMs: null, positionMs: 0 })),
    );

    expect(result.current.canSeek).toBe(false);
    expect(result.current.durationLabel).toBe('--:--');
    expect(result.current.positionLabel).toBe('0:00');
    expect(result.current.progressRatio).toBe(0);
  });

  it.each([
    ['길이를 모르면 0', { durationMs: null, positionMs: 0 }, 0],
    ['재생 위치 비율을 계산한다', { positionMs: 30_000, durationMs: 120_000 }, 0.25],
    ['위치가 길이를 넘으면 1로 clamp한다', { positionMs: 130_000, durationMs: 120_000 }, 1],
  ])('progressRatio: %s', async (_label, overrides, expected) => {
    const { result } = await renderHook(() => usePlaybackSession(buildPlayback(overrides)));

    expect(result.current.progressRatio).toBe(expected);
  });

  it('±10초는 0..durationMs로 clamp해 seekTo 한곳으로 보낸다', async () => {
    const nearStart = buildPlayback({ positionMs: 5_000 });
    const nearEnd = buildPlayback({ positionMs: 57_000 });

    const start = await renderHook(() => usePlaybackSession(nearStart));
    const end = await renderHook(() => usePlaybackSession(nearEnd));

    await act(() => start.result.current.seekBackward());
    await act(() => end.result.current.seekForward());

    expect(nearStart.seekTo).toHaveBeenCalledWith(0);
    expect(nearEnd.seekTo).toHaveBeenCalledWith(60_000);
  });

  it('seek는 status가 아니라 player의 현재 위치를 읽어 연속 입력이 누적된다', async () => {
    const playback = buildPlayback({ positionMs: 20_000 });
    jest.mocked(playback.getPositionMs).mockReturnValueOnce(20_000).mockReturnValueOnce(30_000);

    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(() => result.current.seekForward());
    await act(() => result.current.seekForward());

    expect(playback.seekTo).toHaveBeenNthCalledWith(1, 30_000);
    expect(playback.seekTo).toHaveBeenNthCalledWith(2, 40_000);
  });

  it('길이를 모르면 seek 요청을 무시한다', async () => {
    const playback = buildPlayback({ durationMs: null });
    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(() => result.current.seekForward());

    expect(playback.seekTo).not.toHaveBeenCalled();
  });

  it('READY에서 play는 seek 없이 바로 재생한다', async () => {
    const playback = buildPlayback();
    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(() => result.current.play());

    expect(playback.seekTo).not.toHaveBeenCalled();
    expect(playback.play).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ENDED', { kind: PlaybackStatusKind.ENDED }],
    ['position이 duration에 닿음', { positionMs: 60_000 }],
  ])('%s이면 처음으로 되돌린 뒤 재생한다', async (_label, overrides) => {
    const playback = buildPlayback(overrides);
    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(() => result.current.play());

    expect(playback.seekTo).toHaveBeenCalledWith(0);
    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(jest.mocked(playback.seekTo).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(playback.play).mock.invocationCallOrder[0]!,
    );
  });

  it('native 호출이 실패하면 reject 대신 errorMessage로 알리고 다음 성공에 지운다', async () => {
    const playback = buildPlayback();
    jest.mocked(playback.seekTo).mockRejectedValueOnce(new Error('native seek failed'));

    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(() => result.current.seekForward());

    expect(result.current.errorMessage).toBe('재생 조작에 실패했습니다.');

    await act(() => result.current.seekForward());

    expect(result.current.errorMessage).toBeNull();
  });

  it('ERROR면 앱 문구를 보여준다', async () => {
    const { result } = await renderHook(() =>
      usePlaybackSession(buildPlayback({ kind: PlaybackStatusKind.ERROR })),
    );

    expect(result.current.errorMessage).toBe('재생할 수 없습니다.');
  });

  it('ERROR에서도 pause를 player에 넘긴다', async () => {
    const playback = buildPlayback({ kind: PlaybackStatusKind.ERROR });
    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(async () => result.current.pause());

    expect(playback.pause).toHaveBeenCalledTimes(1);
    expect(result.current.errorMessage).toBe('재생할 수 없습니다.');
  });

  it('pause가 동기로 throw해도 화면까지 올리지 않고 errorMessage로 알린다', async () => {
    const playback = buildPlayback({ kind: PlaybackStatusKind.PLAYING });
    jest.mocked(playback.pause).mockImplementation(() => {
      throw new Error('native pause failed');
    });

    const { result } = await renderHook(() => usePlaybackSession(playback));

    await act(async () => result.current.pause());

    expect(result.current.errorMessage).toBe('재생 조작에 실패했습니다.');
  });
});
