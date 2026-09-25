import type { RecordingStatus as ExpoRecordingStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useVoiceRecorder } from '../../../../modules/voice-recorder';
import { createNativeRecordingAdapter } from './recording-service.native';
import type { NativeRecordingAdapter, RecordingService } from './recording-service-contract';

// 1m 떨어진 말소리를 -18 LUFS 안팎까지 키운다.
// iOS 음성 처리 입력은 약 -42 LUFS, Android 통화용 입력은 약 -27~-30 LUFS로 들어온다.
const INPUT_GAIN_DB = Platform.OS === 'ios' ? 24 : 11;

export function useNativeRecordingService(): RecordingService {
  const adapterRef = useRef<NativeRecordingAdapter | null>(null);
  // 렌더마다 새 함수를 넘기면 native 상태 이벤트 구독이 매번 다시 걸린다.
  const forwardStatusToAdapter = useCallback((status: ExpoRecordingStatus) => {
    adapterRef.current?.receiveExpoStatus(status);
  }, []);
  const recorder = useVoiceRecorder(INPUT_GAIN_DB, forwardStatusToAdapter);
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
