import { type NativeModule, requireOptionalNativeModule } from 'expo';
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

// iOS에만 있는 모듈이다. Android에서 import해도 에러가 나지 않게 optional로 찾는다.
const VoiceRecorder = requireOptionalNativeModule<VoiceRecorderModule>('VoiceRecorder');

// expo-audio useAudioRecorder와 같은 모양의 recorder를 돌려준다.
export function useVoiceRecorder(gainDb: number, onStatus: (status: RecordingStatus) => void) {
  if (VoiceRecorder === null) throw new Error('VoiceRecorder 네이티브 모듈이 없습니다.');

  const voiceRecorder = VoiceRecorder;
  const recorder = useMemo(
    () => ({
      get uri() {
        return voiceRecorder.getStatus().url;
      },
      prepareToRecordAsync: () => voiceRecorder.prepare(gainDb),
      record: () => voiceRecorder.record(),
      pause: () => voiceRecorder.pause(),
      stop: () => voiceRecorder.stop(),
      getStatus: () => voiceRecorder.getStatus(),
    }),
    [gainDb, voiceRecorder],
  );

  /**
   * @when 녹음 화면이 VoiceRecorder를 쓰는 동안 동작한다.
   * @expect native 쓰기 오류·오디오 서비스 재시작을 화면 상태로 전달한다.
   * @clear 화면 이탈 또는 listener 교체 시 구독을 해제한다.
   */
  useEffect(() => {
    const subscription = voiceRecorder.addListener('onRecordingStatusUpdate', onStatus);

    return () => subscription.remove();
  }, [voiceRecorder, onStatus]);

  return recorder;
}
