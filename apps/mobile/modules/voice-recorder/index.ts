import { type NativeModule, requireNativeModule } from 'expo';
import type { RecorderState, RecordingStatus } from 'expo-audio';
import { useEffect, useMemo } from 'react';

type VoiceRecorderEvents = {
  onRecordingStatusUpdate: (status: RecordingStatus) => void;
};

declare class VoiceRecorderModule extends NativeModule<VoiceRecorderEvents> {
  prepare(gainDb: number): Promise<void>;
  record(): void;
  pause(): void;
  stop(): Promise<void>;
  getStatus(): RecorderState;
}

const VoiceRecorder = requireNativeModule<VoiceRecorderModule>('VoiceRecorder');

// expo-audio useAudioRecorder와 같은 모양의 recorder를 돌려준다.
export function useVoiceRecorder(gainDb: number, onStatus: (status: RecordingStatus) => void) {
  const recorder = useMemo(
    () => ({
      get uri() {
        return VoiceRecorder.getStatus().url;
      },
      prepareToRecordAsync: () => VoiceRecorder.prepare(gainDb),
      record: () => VoiceRecorder.record(),
      pause: () => VoiceRecorder.pause(),
      stop: () => VoiceRecorder.stop(),
      getStatus: () => VoiceRecorder.getStatus(),
    }),
    [gainDb],
  );

  /**
   * @when 녹음 화면이 VoiceRecorder를 쓰는 동안 동작한다.
   * @expect native 쓰기 오류·오디오 서비스 재시작을 화면 상태로 전달한다.
   * @clear 화면 이탈 또는 listener 교체 시 구독을 해제한다.
   */
  useEffect(() => {
    const subscription = VoiceRecorder.addListener('onRecordingStatusUpdate', onStatus);

    return () => subscription.remove();
  }, [onStatus]);

  return recorder;
}
