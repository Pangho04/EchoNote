import { CodedError } from '@/shared/lib/coded-error';

export class RecorderBusyError extends CodedError {
  readonly code = 'RECORDER_BUSY' as const;

  constructor(message = '다른 녹음기 명령이 진행 중입니다.') {
    super(message);
  }
}

export class RecorderTimeoutError extends CodedError {
  readonly code = 'RECORDER_TIMEOUT' as const;

  constructor(message = '녹음기 명령이 제한 시간 안에 완료되지 않았습니다.') {
    super(message);
  }
}
