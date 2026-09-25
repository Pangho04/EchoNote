import {
  RecordingPresets,
  type RecordingStatus as ExpoRecordingStatus,
  useAudioRecorder,
} from 'expo-audio';
import { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useVoiceRecorder } from '../../../../modules/voice-recorder';
import { createNativeRecordingAdapter } from './recording-service.native';
import type {
  ExpoAudioRecorderLike,
  NativeRecordingAdapter,
  RecordingService,
} from './recording-service-contract';

// Android 기본 mic 입력은 말소리가 작다. voice_communication은 기기의 소음 제거·자동 음량 조절을 거친다.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    audioSource: 'voice_communication' as const,
  },
};

// iOS 음성 처리 입력은 1m 떨어진 말소리가 약 -42 LUFS라서 -18 LUFS 안팎까지 키운다.
const IOS_INPUT_GAIN_DB = 24;

type RecordingStatusListener = (status: ExpoRecordingStatus) => void;

function useIosRecorder(onStatus: RecordingStatusListener): ExpoAudioRecorderLike {
  return useVoiceRecorder(IOS_INPUT_GAIN_DB, onStatus);
}

function useAndroidRecorder(onStatus: RecordingStatusListener): ExpoAudioRecorderLike {
  return useAudioRecorder(RECORDING_OPTIONS, onStatus);
}

// 플랫폼은 실행 중 바뀌지 않으므로 모듈을 불러올 때 한 번 고른다.
const useRecorder = Platform.OS === 'ios' ? useIosRecorder : useAndroidRecorder;

export function useNativeRecordingService(): RecordingService {
  const adapterRef = useRef<NativeRecordingAdapter | null>(null);
  const recorder = useRecorder((status: ExpoRecordingStatus) => {
    adapterRef.current?.receiveExpoStatus(status);
  });
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
