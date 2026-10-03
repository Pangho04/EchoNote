import { useState } from 'react';

import { UI_STRINGS } from '@/shared/config/ui-strings';

import { type AudioPlayback, PlaybackStatusKind } from '../api/audio-playback';
import { clampPlaybackPosition } from './clamp-playback-position';

const SEEK_STEP_MS = 10_000;

export interface PlaybackSessionViewModel {
  status: PlaybackStatusKind;
  positionMs: number;
  positionLabel: string;
  durationLabel: string;
  progressRatio: number;
  errorMessage: string | null;
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  play(): Promise<void>;
  pause(): void;
  seekBackward(): Promise<void>;
  seekForward(): Promise<void>;
  playFrom(ms: number): Promise<void>;
}

interface ButtonState {
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
}

function toButtonState(kind: PlaybackStatusKind, hasDuration: boolean): ButtonState {
  switch (kind) {
    case PlaybackStatusKind.LOADING:
    case PlaybackStatusKind.ERROR:
      return { canPlay: false, canPause: false, canSeek: false };

    case PlaybackStatusKind.READY:
    case PlaybackStatusKind.ENDED:
      return { canPlay: true, canPause: false, canSeek: hasDuration };

    case PlaybackStatusKind.PLAYING:
      return { canPlay: false, canPause: true, canSeek: hasDuration };
  }
}

// 1시간 미만은 m:ss, 이상은 h:mm:ss. 길이를 모르면 --:--.
export function formatClockLabel(ms: number | null): string {
  if (ms === null) return UI_STRINGS.playback.unknownTime;

  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;

  return `${minutes}:${seconds}`;
}

export function usePlaybackSession(playback: AudioPlayback): PlaybackSessionViewModel {
  const { kind, positionMs, durationMs } = playback.status;
  const [commandError, setCommandError] = useState<string | null>(null);

  // native 호출 실패는 status에 실리지 않으므로 여기서 잡아 화면에 알린다.
  async function run(command: () => void | Promise<void>): Promise<void> {
    try {
      await command();
      setCommandError(null);
    } catch {
      setCommandError(UI_STRINGS.playback.controlFailed);
    }
  }

  function isAtEnd(): boolean {
    if (kind === PlaybackStatusKind.ENDED) return true;

    return durationMs !== null && playback.getPositionMs() >= durationMs;
  }

  // 끝에서 play하면 native player가 아무것도 하지 않으므로 처음으로 되돌린 뒤 재생한다.
  function play(): Promise<void> {
    return run(async () => {
      if (isAtEnd()) await playback.seekTo(0);

      playback.play();
    });
  }

  function seekBy(deltaMs: number): Promise<void> {
    if (durationMs === null) return Promise.resolve();

    return run(() =>
      playback.seekTo(
        clampPlaybackPosition({ positionMs: playback.getPositionMs(), deltaMs, durationMs }),
      ),
    );
  }

  // 끝 위치로 옮기면 바로 ENDED가 되므로 마지막 1ms 앞에서 멈춘다. ENDED여도 처음으로 되감지 않는다.
  function playFrom(ms: number): Promise<void> {
    const { canSeek } = toButtonState(kind, durationMs !== null);

    if (durationMs === null || durationMs <= 0 || !canSeek) return Promise.resolve();

    return run(async () => {
      await playback.seekTo(Math.min(ms, durationMs - 1));
      playback.play();
    });
  }

  // native 오류 원문은 영어이고 플랫폼마다 달라 사용자가 할 일을 알려주지 않는다. 앱 문구로만 알린다.
  const statusError = kind === PlaybackStatusKind.ERROR ? UI_STRINGS.playback.failed : null;

  return {
    status: kind,
    positionMs,
    positionLabel: formatClockLabel(positionMs),
    durationLabel: formatClockLabel(durationMs),
    progressRatio: durationMs === null ? 0 : Math.min(Math.max(positionMs / durationMs, 0), 1),
    errorMessage: statusError ?? commandError,
    ...toButtonState(kind, durationMs !== null),
    play,
    pause: () => void run(() => playback.pause()),
    seekBackward: () => seekBy(-SEEK_STEP_MS),
    seekForward: () => seekBy(SEEK_STEP_MS),
    playFrom,
  };
}
