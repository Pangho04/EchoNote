import type { OperationQueue } from '@/shared/lib/operation-queue';

import type { ExpoAudioRecorderLike } from './recording-service';
import {
  RecorderDisposedError,
  RecorderState,
  type RecordingService,
  type StoppedRecordingCandidate,
} from './recording-service';
import type { SnapshotManager } from './recording-service.snapshot';

export enum RecorderCommand {
  PREPARE = 'PREPARE',
  RECORD = 'RECORD',
  PAUSE = 'PAUSE',
  STOP = 'STOP',
}

export function createRecordingServiceAdapter(
  recorder: ExpoAudioRecorderLike,
  operationQueue: OperationQueue<RecorderCommand>,
  snapshotManager: SnapshotManager,
): RecordingService {
  let nativeStopPromise: Promise<void> | null = null;
  let stoppedCandidate: StoppedRecordingCandidate | null = null;
  let disposePromise: Promise<void> | null = null;

  function stopNativeOnce(): Promise<void> {
    nativeStopPromise ??= recorder.stop();
    return nativeStopPromise;
  }

  function requireSnapshotState(
    commandName: string,
    allowedStates: readonly RecorderState[],
  ): void {
    const currentState = snapshotManager.getSnapshot().state;
    if (!allowedStates.includes(currentState)) {
      throw new Error(
        `${commandName} 명령을 ${RecorderState[currentState]} 상태에서 실행할 수 없습니다.`,
      );
    }
  }

  function runOperationWithSnapshot<T>(
    command: RecorderCommand,
    execute: () => Promise<T>,
  ): Promise<T> {
    return operationQueue.runOperation(command, execute);
  }

  const service: RecordingService = {
    prepare: () =>
      runOperationWithSnapshot(RecorderCommand.PREPARE, async () => {
        requireSnapshotState('prepare', [RecorderState.UNPREPARED]);
        await recorder.prepareToRecordAsync();

        const recorderStatus = recorder.getStatus();

        if (!recorderStatus.canRecord) {
          throw new Error('녹음기가 준비 완료 상태가 아닙니다.');
        }

        snapshotManager.publishSnapshot({
          state: RecorderState.READY,
          durationMs: recorderStatus.durationMillis,
          errorMessage: null,
        });
      }),

    record: () =>
      runOperationWithSnapshot(RecorderCommand.RECORD, async () => {
        requireSnapshotState('record', [RecorderState.READY, RecorderState.PAUSED]);
        recorder.record();

        const recorderStatus = recorder.getStatus();

        if (!recorderStatus.isRecording) {
          throw new Error('녹음 시작 상태를 확인하지 못했습니다.');
        }

        snapshotManager.publishSnapshot({
          state: RecorderState.RECORDING,
          durationMs: recorderStatus.durationMillis,
          errorMessage: null,
        });
      }),

    pause: () =>
      runOperationWithSnapshot(RecorderCommand.PAUSE, async () => {
        requireSnapshotState('pause', [RecorderState.RECORDING]);
        recorder.pause();

        const recorderStatus = recorder.getStatus();

        if (recorderStatus.isRecording || !recorderStatus.canRecord) {
          throw new Error('녹음 일시정지 상태를 확인하지 못했습니다.');
        }

        snapshotManager.publishSnapshot({
          state: RecorderState.PAUSED,
          durationMs: recorderStatus.durationMillis,
          errorMessage: null,
        });
      }),

    stop: () => {
      if (stoppedCandidate !== null) return Promise.resolve(stoppedCandidate);

      return runOperationWithSnapshot(RecorderCommand.STOP, async () => {
        requireSnapshotState('stop', [RecorderState.RECORDING, RecorderState.PAUSED]);
        await stopNativeOnce();

        const recorderStatus = recorder.getStatus();
        const tempUri = recorder.uri ?? recorderStatus.url;

        if (tempUri === null) {
          snapshotManager.publishSnapshot({
            state: RecorderState.ERROR,
            durationMs: recorderStatus.durationMillis,
            errorMessage: '녹음 파일 URI가 없습니다.',
          });
          throw new Error('녹음 파일 URI가 없습니다.');
        }

        stoppedCandidate = {
          tempUri,
          durationMs: recorderStatus.durationMillis,
        };

        snapshotManager.publishSnapshot({
          state: RecorderState.STOPPED,
          durationMs: recorderStatus.durationMillis,
          errorMessage: null,
        });

        return stoppedCandidate;
      });
    },

    subscribe: (listener) => {
      if (operationQueue.isDisposed()) throw new RecorderDisposedError();
      return snapshotManager.subscribe(listener);
    },

    dispose: () => {
      if (disposePromise !== null) return disposePromise;

      const stateBeforeDispose = snapshotManager.getSnapshot().state;
      const commandBeforeDispose = operationQueue.getActiveCommand();
      operationQueue.dispose();
      snapshotManager.clearListener();

      const needsStop =
        stateBeforeDispose === RecorderState.RECORDING ||
        stateBeforeDispose === RecorderState.PAUSED ||
        commandBeforeDispose === RecorderCommand.RECORD ||
        nativeStopPromise !== null;

      if (!needsStop) return (disposePromise = Promise.resolve());

      disposePromise = stopNativeOnce().catch(() => {
        // 정리 단계의 native 오류는 화면 이탈을 막지 않는다.
      });
      return disposePromise;
    },
  };

  return service;
}
