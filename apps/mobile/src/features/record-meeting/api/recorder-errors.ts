import { RecorderError } from '@/shared/lib/recorder-errors';

export class RecorderBusyError extends RecorderError {
  readonly code = 'RECORDER_BUSY' as const;

  constructor(message = '다른 녹음기 명령이 진행 중입니다.') {
    super(message);
  }
}

export class RecorderTimeoutError extends RecorderError {
  readonly code = 'RECORDER_TIMEOUT' as const;

  constructor(message = '녹음기 명령이 제한 시간 안에 완료되지 않았습니다.') {
    super(message);
  }
}
