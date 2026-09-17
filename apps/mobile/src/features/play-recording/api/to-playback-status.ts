import type { AudioStatus as ExpoAudioStatus } from 'expo-audio';

import { type AudioPlaybackStatus, PlaybackStatusKind } from './audio-playback';

export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1_000);
}

function toKind(status: ExpoAudioStatus): PlaybackStatusKind {
  if (status.error !== null || status.mediaServicesDidReset === true) {
    return PlaybackStatusKind.ERROR;
  }

  if (!status.isLoaded) return PlaybackStatusKind.LOADING;

  if (status.didJustFinish) return PlaybackStatusKind.ENDED;

  if (status.playing) return PlaybackStatusKind.PLAYING;

  return PlaybackStatusKind.READY;
}

// Expo AudioStatus는 seconds 단위다. 여기서만 millisecond로 바꾼다.
export function toPlaybackStatus(status: ExpoAudioStatus): AudioPlaybackStatus {
  const hasDuration = Number.isFinite(status.duration) && status.duration > 0;

  return {
    kind: toKind(status),
    positionMs: secondsToMs(status.currentTime),
    durationMs: hasDuration ? secondsToMs(status.duration) : null,
    errorMessage: status.error,
  };
}
