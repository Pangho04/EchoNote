import type {
  RecorderState as ExpoRecorderState,
  RecordingStatus as ExpoRecordingStatus,
} from 'expo-audio';

export interface StoppedRecordingCandidate {
  tempUri: string;
  durationMs: number;
}

export enum RecorderState {
  UNPREPARED,
  READY,
  RECORDING,
  PAUSED,
  STOPPED,
  ERROR,
}

export interface RecorderSnapshot {
  state: RecorderState;
  durationMs: number;
  errorMessage: string | null;
}

export type RecorderStateListener = (snapshot: RecorderSnapshot) => void;

export class RecorderDisposedError extends Error {
  readonly code = 'RECORDER_DISPOSED' as const;

  constructor() {
    super('녹음기가 정리되었습니다.');
    this.name = 'RecorderDisposedError';
  }
}

export interface RecordingService {
  prepare: () => Promise<void>;
  record: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<StoppedRecordingCandidate>;
  subscribe: (listener: RecorderStateListener) => () => void;
  dispose: () => Promise<void>;
}

export interface ExpoAudioRecorderLike {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  pause(): void;
  stop(): Promise<void>;
  getStatus(): ExpoRecorderState;
}

export interface NativeRecordingAdapter {
  service: RecordingService;
  receiveExpoStatus(status: ExpoRecordingStatus): void;
  // 앱 명령 없이 바뀐 native 녹음 상태를 화면 상태에 맞춘다.
  reconcileWithNative(): void;
}
