import { renderHook } from '@testing-library/react-native';
import {
  type AudioPlayer,
  type AudioStatus as ExpoAudioStatus,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';

import { PlaybackStatusKind } from './audio-playback';
import { useAudioPlayback } from './use-audio-playback.native';

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn(),
}));

const player = {
  currentTime: 12.5,
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async () => {}),
} as unknown as AudioPlayer;

const expoStatus = {
  currentTime: 12.5,
  duration: 30,
  isLoaded: true,
  playing: true,
  didJustFinish: false,
  error: null,
} as ExpoAudioStatus;

describe('useAudioPlayback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (player as { currentTime: number }).currentTime = 12.5;
    jest.mocked(useAudioPlayer).mockReturnValue(player);
    jest.mocked(useAudioPlayerStatus).mockReturnValue(expoStatus);
  });

  it('uri로 player를 만들고 mount 때 재생용 audio mode를 켠다', async () => {
    await renderHook(() => useAudioPlayback('file://recording.m4a'));

    expect(useAudioPlayer).toHaveBeenCalledWith({ uri: 'file://recording.m4a' });
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  });

  it('status와 현재 위치는 ms로, seekTo는 seconds로 바꿔 player에 넘긴다', async () => {
    const { result } = await renderHook(() => useAudioPlayback('file://recording.m4a'));

    await result.current.seekTo(15_000);
    result.current.play();
    result.current.pause();

    expect(result.current.status).toEqual({
      kind: PlaybackStatusKind.PLAYING,
      positionMs: 12_500,
      durationMs: 30_000,
      errorMessage: null,
    });
    expect(result.current.getPositionMs()).toBe(12_500);

    // status 갱신 없이도 player의 현재 위치를 호출 시점마다 다시 읽는다.
    (player as { currentTime: number }).currentTime = 20;

    expect(result.current.getPositionMs()).toBe(20_000);
    expect(player.seekTo).toHaveBeenCalledWith(15);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
  });
});
