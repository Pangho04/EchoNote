import { setAudioModeAsync } from 'expo-audio';

import { createOperationQueue } from '@/shared/lib/operation-queue';

import { RecorderBusyError, RecorderTimeoutError } from './recorder-errors';
import type { RecorderCommand } from './recording-service.adapter';
import { createRecordingServiceAdapter } from './recording-service.adapter';
import { createExpoStatusMapper } from './recording-service.expo-mapper';
import { createSnapshotManager } from './recording-service.snapshot';
import type {
  ExpoAudioRecorderLike,
  NativeRecordingAdapter,
  RecorderSnapshot,
} from './recording-service-contract';
import { RecorderDisposedError, RecorderState } from './recording-service-contract';

// iOS는 audio mode의 allowsRecording이 true여야 native record를 허용한다.
function withRecordingAudioMode(recorder: ExpoAudioRecorderLike): ExpoAudioRecorderLike {
  return {
    get uri() {
      return recorder.uri;
    },
    prepareToRecordAsync: async () => {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
    },
    record: () => recorder.record(),
    pause: () => recorder.pause(),
    stop: () => recorder.stop(),
    getStatus: () => recorder.getStatus(),
  };
}

export function createNativeRecordingAdapter(
  recorder: ExpoAudioRecorderLike,
): NativeRecordingAdapter {
  const initialSnapshot: RecorderSnapshot = {
    state: RecorderState.UNPREPARED,
    durationMs: 0,
    errorMessage: null,
  };

  const operationQueue = createOperationQueue<RecorderCommand>({
    timeoutMs: 10_000,
    onTimeout: (command) =>
      new RecorderTimeoutError(`녹음기 ${command} 명령이 제한 시간 안에 완료되지 않았습니다.`),
    onBusy: (command) => new RecorderBusyError(`다른 녹음기 명령(${command})이 진행 중입니다.`),
    onDisposed: () => new RecorderDisposedError(),
  });

  const snapshotManager = createSnapshotManager(initialSnapshot);
  const service = createRecordingServiceAdapter(
    withRecordingAudioMode(recorder),
    operationQueue,
    snapshotManager,
  );
  const receiveExpoStatus = createExpoStatusMapper(
    recorder,
    operationQueue,
    snapshotManager,
  ).receiveExpoStatus;

  return {
    service,
    receiveExpoStatus,
  };
}
