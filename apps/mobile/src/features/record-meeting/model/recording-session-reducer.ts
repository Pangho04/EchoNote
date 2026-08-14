import type { StoppedRecordingCandidate } from '../api/recording-service';

export enum RecordingState {
  PREPARE,
  RECORD,
  PAUSE,
  STOP,
}

export enum RecordingStatus {
  REQUESTED,
  PROCESSING,
  COMPLETED,
  FAILED,
}

export type RecordingSessionState =
  | { state: RecordingState.PREPARE; status: RecordingStatus.PROCESSING }
  | { state: RecordingState.RECORD; status: RecordingStatus.PROCESSING }
  | { state: RecordingState.RECORD; status: RecordingStatus.COMPLETED }
  | { state: RecordingState.PAUSE; status: RecordingStatus.PROCESSING }
  | { state: RecordingState.PAUSE; status: RecordingStatus.COMPLETED }
  | { state: RecordingState.STOP; status: RecordingStatus.PROCESSING }
  | {
      state: RecordingState.STOP;
      status: RecordingStatus.COMPLETED;
      candidate: StoppedRecordingCandidate;
    }
  | {
      state: RecordingState;
      status: RecordingStatus.FAILED;
      message: string;
    };

export type RecordingSessionEvent =
  | { state: RecordingState.PREPARE; status: RecordingStatus.COMPLETED }
  | { state: RecordingState.RECORD; status: RecordingStatus.REQUESTED }
  | { state: RecordingState.RECORD; status: RecordingStatus.COMPLETED }
  | { state: RecordingState.PAUSE; status: RecordingStatus.REQUESTED }
  | { state: RecordingState.PAUSE; status: RecordingStatus.COMPLETED }
  | { state: RecordingState.STOP; status: RecordingStatus.REQUESTED }
  | {
      state: RecordingState.STOP;
      status: RecordingStatus.COMPLETED;
      candidate: StoppedRecordingCandidate;
    }
  | {
      state: RecordingState;
      status: RecordingStatus.FAILED;
      message: string;
    };

/** 현재 작업에 귀속된 실패 Event를 받아들일 수 있는 상태인지 판정한다. */
function canFail(state: RecordingSessionState): boolean {
  if (state.status === RecordingStatus.PROCESSING) return true;

  // 녹음·일시정지 안정 상태에서도 native runtime 오류가 발생할 수 있다.
  return (
    state.status === RecordingStatus.COMPLETED &&
    (state.state === RecordingState.RECORD || state.state === RecordingState.PAUSE)
  );
}

/** 현재 session State와 Event를 허용된 다음 State로 바꾸는 순수 전이 함수다. */
export function recordingSessionReducer(
  state: RecordingSessionState,
  event: RecordingSessionEvent,
): RecordingSessionState {
  // 복구하지 않는 최종 오류 상태에서는 첫 오류와 상태를 그대로 보존한다.
  if (state.status === RecordingStatus.FAILED) return state;

  // 현재 작업에서 발생한 실패만 복구하지 않는 최종 오류 상태로 반영한다.
  if (event.status === RecordingStatus.FAILED) {
    if (event.state !== state.state || !canFail(state)) return state;

    return {
      state: event.state,
      status: RecordingStatus.FAILED,
      message: event.message,
    };
  }

  // 준비 완료 뒤 별도 시작 버튼 없이 녹음 명령 실행 상태로 이동한다.
  if (
    state.state === RecordingState.PREPARE &&
    state.status === RecordingStatus.PROCESSING &&
    event.state === RecordingState.PREPARE &&
    event.status === RecordingStatus.COMPLETED
  ) {
    return {
      state: RecordingState.RECORD,
      status: RecordingStatus.PROCESSING,
    };
  }

  // Native 녹음 시작 또는 재개가 관찰되면 녹음 중 안정 상태가 된다.
  if (
    state.state === RecordingState.RECORD &&
    state.status === RecordingStatus.PROCESSING &&
    event.state === RecordingState.RECORD &&
    event.status === RecordingStatus.COMPLETED
  ) {
    return {
      state: RecordingState.RECORD,
      status: RecordingStatus.COMPLETED,
    };
  }

  // 녹음 중 일시정지 요청을 받으면 pause 명령 실행 상태로 이동한다.
  if (
    state.state === RecordingState.RECORD &&
    state.status === RecordingStatus.COMPLETED &&
    event.state === RecordingState.PAUSE &&
    event.status === RecordingStatus.REQUESTED
  ) {
    return {
      state: RecordingState.PAUSE,
      status: RecordingStatus.PROCESSING,
    };
  }

  // Native 일시정지가 관찰되면 일시정지 안정 상태가 된다.
  if (
    state.state === RecordingState.PAUSE &&
    state.status === RecordingStatus.PROCESSING &&
    event.state === RecordingState.PAUSE &&
    event.status === RecordingStatus.COMPLETED
  ) {
    return {
      state: RecordingState.PAUSE,
      status: RecordingStatus.COMPLETED,
    };
  }

  // 일시정지 중 녹음 요청을 받으면 재개 명령 실행 상태로 이동한다.
  if (
    state.state === RecordingState.PAUSE &&
    state.status === RecordingStatus.COMPLETED &&
    event.state === RecordingState.RECORD &&
    event.status === RecordingStatus.REQUESTED
  ) {
    return {
      state: RecordingState.RECORD,
      status: RecordingStatus.PROCESSING,
    };
  }

  // 녹음 중과 일시정지 중에만 종료를 요청할 수 있다.
  const canRequestStop =
    state.status === RecordingStatus.COMPLETED &&
    (state.state === RecordingState.RECORD || state.state === RecordingState.PAUSE);

  // 종료 요청을 받으면 stop 명령 실행 상태로 이동한다.
  if (
    canRequestStop &&
    event.state === RecordingState.STOP &&
    event.status === RecordingStatus.REQUESTED
  ) {
    return {
      state: RecordingState.STOP,
      status: RecordingStatus.PROCESSING,
    };
  }

  // Native 종료가 완료되면 저장 단계가 사용할 임시 파일 후보를 보관한다.
  if (
    state.state === RecordingState.STOP &&
    state.status === RecordingStatus.PROCESSING &&
    event.state === RecordingState.STOP &&
    event.status === RecordingStatus.COMPLETED
  ) {
    return {
      state: RecordingState.STOP,
      status: RecordingStatus.COMPLETED,
      candidate: event.candidate,
    };
  }

  // 허용되지 않은 요청과 늦거나 중복된 Event는 현재 State를 유지한다.
  return state;
}
