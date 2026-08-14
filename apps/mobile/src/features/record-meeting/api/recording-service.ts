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
