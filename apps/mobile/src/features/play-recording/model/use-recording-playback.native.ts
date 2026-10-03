import { useAudioPlayback } from '../api/use-audio-playback.native';
import { type PlaybackSessionViewModel, usePlaybackSession } from './use-playback-session';

// saved final URI만 받아 native player를 연다. 원본 파일은 읽기만 한다.
export function useRecordingPlayback(uri: string): PlaybackSessionViewModel {
  return usePlaybackSession(useAudioPlayback(uri));
}
