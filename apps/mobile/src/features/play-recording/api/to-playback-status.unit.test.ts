import type { AudioStatus as ExpoAudioStatus } from 'expo-audio';
import { describe, expect, it } from 'vitest';

import { PlaybackStatusKind } from './audio-playback';
import { toPlaybackStatus } from './to-playback-status';

function buildExpoStatus(overrides: Partial<ExpoAudioStatus> = {}): ExpoAudioStatus {
  return {
    id: 'player-1',
    currentTime: 0,
    playbackState: 'idle',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 0,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: true,
    isLive: false,
    currentOffsetFromLive: null,
    error: null,
    ...overrides,
  };
}

describe('toPlaybackStatus', () => {
  it('seconds를 millisecond로 바꾸고 길이 0은 null로 둔다', () => {
    expect(toPlaybackStatus(buildExpoStatus({ currentTime: 12.3456, duration: 30.5 }))).toEqual({
      kind: PlaybackStatusKind.READY,
      positionMs: 12_346,
      durationMs: 30_500,
      errorMessage: null,
    });

    expect(toPlaybackStatus(buildExpoStatus({ duration: 0 })).durationMs).toBeNull();
    expect(toPlaybackStatus(buildExpoStatus({ duration: Infinity })).durationMs).toBeNull();
  });

  it.each([
    ['error', { error: '재생 실패' }, PlaybackStatusKind.ERROR],
    ['mediaServicesDidReset', { mediaServicesDidReset: true }, PlaybackStatusKind.ERROR],
    ['!isLoaded', { isLoaded: false }, PlaybackStatusKind.LOADING],
    ['didJustFinish', { didJustFinish: true, playing: true }, PlaybackStatusKind.ENDED],
    ['playing', { playing: true }, PlaybackStatusKind.PLAYING],
    ['loaded·정지', {}, PlaybackStatusKind.READY],
  ] as const)('%s → kind 매핑', (_label, overrides, kind) => {
    expect(toPlaybackStatus(buildExpoStatus(overrides)).kind).toBe(kind);
  });

  it('error가 있으면 isLoaded·playing보다 먼저 ERROR로 판정하고 message를 그대로 싣는다', () => {
    const status = toPlaybackStatus(
      buildExpoStatus({ error: '파일을 열 수 없습니다.', isLoaded: false, playing: true }),
    );

    expect(status.kind).toBe(PlaybackStatusKind.ERROR);
    expect(status.errorMessage).toBe('파일을 열 수 없습니다.');
  });
});
