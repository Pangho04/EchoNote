import { createOperationQueue } from '@/shared/lib/operation-queue';

import { RecorderBusyError, RecorderTimeoutError } from './recorder-errors';
import type { ExpoAudioRecorderLike, NativeRecordingAdapter } from './recording-service';
import { RecorderDisposedError } from './recording-service';
import type { RecorderCommand } from './recording-service.adapter';
import { createRecordingServiceAdapter } from './recording-service.adapter';
import { createExpoStatusMapper } from './recording-service.expo-mapper';
import { createSnapshotManager } from './recording-service.snapshot';

export function createNativeRecordingAdapter(
  recorder: ExpoAudioRecorderLike,
): NativeRecordingAdapter {
  const initialSnapshot = {
    state: 0, // RecorderState.UNPREPARED
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
  const service = createRecordingServiceAdapter(recorder, operationQueue, snapshotManager);
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
