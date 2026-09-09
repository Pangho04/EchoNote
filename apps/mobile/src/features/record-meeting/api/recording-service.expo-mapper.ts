import type {
  RecorderState as ExpoRecorderState,
  RecordingStatus as ExpoRecordingStatus,
} from 'expo-audio';

import { normalizeError } from '@/shared/lib/coded-error';
import type { OperationQueue } from '@/shared/lib/operation-queue';

import { RecorderCommand } from './recording-service.adapter';
import type { SnapshotManager } from './recording-service.snapshot';
import { RecorderState } from './recording-service-contract';

export interface ExpoRecorderLike {
  getStatus(): ExpoRecorderState;
  uri: string | null;
}

export interface ExpoStatusMapper {
  receiveExpoStatus(status: ExpoRecordingStatus): void;
}

function publishErrorSnapshot(
  snapshotManager: SnapshotManager,
  errorMessage: string,
  durationMs: number,
): void {
  snapshotManager.publishSnapshot({
    state: RecorderState.ERROR,
    durationMs,
    errorMessage,
  });
}

export function createExpoStatusMapper(
  recorder: ExpoRecorderLike,
  operationQueue: OperationQueue<RecorderCommand>,
  snapshotManager: SnapshotManager,
): ExpoStatusMapper {
  function receiveExpoStatus(status: ExpoRecordingStatus): void {
    if (operationQueue.isDisposed()) return;

    let recorderStatus: ExpoRecorderState;

    try {
      recorderStatus = recorder.getStatus();
    } catch (error) {
      const hadActiveOperation = operationQueue.getActiveCommand() !== null;
      const normalizedError = normalizeError(error);

      if (hadActiveOperation) {
        publishErrorSnapshot(
          snapshotManager,
          normalizedError.message,
          snapshotManager.getSnapshot().durationMs,
        );
        operationQueue.rejectActive(normalizedError);
      } else {
        publishErrorSnapshot(
          snapshotManager,
          normalizedError.message,
          snapshotManager.getSnapshot().durationMs,
        );
      }
      return;
    }

    const hasError =
      status.hasError ||
      status.mediaServicesDidReset === true ||
      recorderStatus.mediaServicesDidReset;

    if (hasError) {
      const errorMessage = status.error ?? '녹음기 상태를 확인하지 못했습니다.';
      const hadActiveOperation = operationQueue.getActiveCommand() !== null;

      if (hadActiveOperation) {
        publishErrorSnapshot(snapshotManager, errorMessage, recorderStatus.durationMillis);
        operationQueue.rejectActive(new Error(errorMessage));
      } else {
        publishErrorSnapshot(snapshotManager, errorMessage, recorderStatus.durationMillis);
      }
      return;
    }

    if (status.isFinished) {
      const activeCommand = operationQueue.getActiveCommand();
      const stopIsExpected =
        activeCommand === RecorderCommand.STOP ||
        snapshotManager.getSnapshot().state === RecorderState.STOPPED;

      if (stopIsExpected) return;

      publishErrorSnapshot(
        snapshotManager,
        '녹음이 예상과 다르게 종료되었습니다.',
        recorderStatus.durationMillis,
      );
    }
  }

  return { receiveExpoStatus };
}
