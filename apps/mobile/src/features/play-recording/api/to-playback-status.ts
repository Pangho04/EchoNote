import type { AudioStatus as ExpoAudioStatus } from 'expo-audio';

import { type AudioPlaybackStatus, PlaybackStatusKind } from './audio-playback';

export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1_000);
}

function toKind(status: ExpoAudioStatus, hasDuration: boolean): PlaybackStatusKind {
  if (status.error !== null || status.mediaServicesDidReset === true) {
    return PlaybackStatusKind.ERROR;
  }

  // Android는 이동 직후 버퍼링 동안에도 isLoaded=false를 보고한다. 길이를 이미 알면 로드가 끝난 player로 본다.
  if (!status.isLoaded && !hasDuration) return PlaybackStatusKind.LOADING;

  if (status.didJustFinish) return PlaybackStatusKind.ENDED;

  if (status.playing) return PlaybackStatusKind.PLAYING;

  return PlaybackStatusKind.READY;
}

// Expo AudioStatus는 seconds 단위다. 여기서만 millisecond로 바꾼다.
export function toPlaybackStatus(status: ExpoAudioStatus): AudioPlaybackStatus {
  const hasDuration = Number.isFinite(status.duration) && status.duration > 0;

  return {
    kind: toKind(status, hasDuration),
    positionMs: secondsToMs(status.currentTime),
    durationMs: hasDuration ? secondsToMs(status.duration) : null,
  };
}
