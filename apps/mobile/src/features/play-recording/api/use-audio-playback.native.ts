import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';

import type { AudioPlayback } from './audio-playback';
import { secondsToMs, toPlaybackStatus } from './to-playback-status';

// player 생성·해제는 useAudioPlayer가 소유한다. uri가 바뀌면 새 player로 교체된다.
export function useAudioPlayback(uri: string): AudioPlayback {
  const player = useAudioPlayer({ uri });
  const expoStatus = useAudioPlayerStatus(player);

  /**
   * @when 저장된 녹음을 재생하는 화면이 열릴 때
   * @expect 녹음 화면이 켜둔 allowsRecording을 꺼서 iOS 출력이 수화부가 아닌 스피커로 나오게 한다. 실패해도 재생은 막지 않는다.
   * @clear -
   */
  useEffect(() => {
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, []);

  return {
    status: toPlaybackStatus(expoStatus),
    getPositionMs: () => secondsToMs(player.currentTime),
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (positionMs) => player.seekTo(positionMs / 1_000),
  };
}
