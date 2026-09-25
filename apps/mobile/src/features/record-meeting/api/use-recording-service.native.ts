import {
  RecordingPresets,
  type RecordingStatus as ExpoRecordingStatus,
  useAudioRecorder,
} from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { createNativeRecordingAdapter } from './recording-service.native';
import type { RecordingService } from './recording-service-contract';
import type { NativeRecordingAdapter } from './recording-service-contract';

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

  /**
   * @when 녹음 화면이 떠 있는 동안 앱이 다시 화면 앞으로 돌아올 때 동작한다.
   * @expect 전화 같은 중단으로 바뀐 native 녹음 상태를 화면 상태에 맞춘다.
   * @clear 화면 이탈 또는 recorder 교체 시 AppState 구독을 해제한다.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') adapter.reconcileWithNative();
    });

    return () => subscription.remove();
  }, [adapter]);

  return adapter.service;
}
