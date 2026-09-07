import {
  RecordingPresets,
  type RecordingStatus as ExpoRecordingStatus,
  useAudioRecorder,
} from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';

import type { RecordingService } from './recording-service';
import type { NativeRecordingAdapter } from './recording-service';
import { createNativeRecordingAdapter } from './recording-service.native';

export function useNativeRecordingService(): RecordingService {
  const adapterRef = useRef<NativeRecordingAdapter | null>(null);
  const recorder = useAudioRecorder(
    RecordingPresets.HIGH_QUALITY,
    (status: ExpoRecordingStatus) => {
      adapterRef.current?.receiveExpoStatus(status);
    },
  );
  const adapter = useMemo(() => createNativeRecordingAdapter(recorder), [recorder]);

  /**
   * @when 녹음 화면이 native recorder adapter를 소유하는 동안 동작한다.
   * @expect Expo status callback이 현재 adapter로 전달되고 같은 service가 유지된다.
   * @clear 화면 이탈 또는 recorder 교체 시 callback 연결을 끊고 recorder를 정리한다.
   */
  useEffect(() => {
    adapterRef.current = adapter;

    return () => {
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }

      void adapter.service.dispose();
    };
  }, [adapter]);

  return adapter.service;
}
