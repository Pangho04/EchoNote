import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Recording } from '../../../entities/recording';
import * as recordMeetingPublicApi from '..';
import {
  RecorderDisposedError,
  type RecorderSnapshot,
  RecorderState,
  type RecorderStateListener,
  type RecordingService,
  type StoppedRecordingCandidate,
} from '../api/recording-service-contract';
import {
  type RecordingSessionEvent,
  recordingSessionReducer,
  type RecordingSessionState,
  RecordingState,
  RecordingStatus,
} from './recording-session-reducer';

const candidate: StoppedRecordingCandidate = {
  tempUri: 'file:///virtual/recording.m4a',
  durationMs: 30_000,
};

describe('G1-2 public type and port contract', () => {
  it('저장된 Recording은 meetingId를 공유하는 6필드 Domain이다', () => {
    expectTypeOf<Recording>().toEqualTypeOf<{
      meetingId: string;
      uri: string;
      mimeType: string;
      sha256: string;
      durationMs: number;
      byteSize: number;
    }>();
  });

  it('native stop 후보는 임시 URI와 duration만 가진다', () => {
    expectTypeOf<StoppedRecordingCandidate>().toEqualTypeOf<{
      tempUri: string;
      durationMs: number;
    }>();
  });

  it('기기 상태 snapshot은 model 진행 상태와 별도 계약이다', () => {
    expectTypeOf<RecorderSnapshot>().toEqualTypeOf<{
      state: RecorderState;
      durationMs: number;
      errorMessage: string | null;
    }>();
    expectTypeOf<RecorderStateListener>().toEqualTypeOf<(snapshot: RecorderSnapshot) => void>();
  });

  it('RecordingService는 준비·녹음·일시정지·종료·구독·정리를 제공한다', () => {
    expectTypeOf<RecordingService>().toEqualTypeOf<{
      prepare: () => Promise<void>;
      record: () => Promise<void>;
      pause: () => Promise<void>;
      stop: () => Promise<StoppedRecordingCandidate>;
      subscribe: (listener: RecorderStateListener) => () => void;
      dispose: () => Promise<void>;
    }>();
  });

  it('dispose 취소 오류를 안정된 name과 code로 식별한다', () => {
    const error = new RecorderDisposedError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RecorderDisposedError');
    expect(error.code).toBe('RECORDER_DISPOSED');
  });

  it('State와 Event는 서로 다른 discriminated union이다', () => {
    expectTypeOf<RecordingSessionState>().toEqualTypeOf<
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
        }
    >();

    expectTypeOf<RecordingSessionEvent>().toEqualTypeOf<
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
        }
    >();
  });

  it('feature 공개 API에서는 기기 port value만 제공한다', () => {
    expect(recordMeetingPublicApi).toMatchObject({
      RecorderDisposedError,
      RecorderState,
    });
    expect(recordMeetingPublicApi).not.toHaveProperty('RecordingPersistenceState');
    expect(recordMeetingPublicApi).not.toHaveProperty('RecordingState');
  });
});

describe('recordingSessionReducer', () => {
  it('준비 완료 뒤 자동 녹음하고 일시정지·재개·종료한다', () => {
    const preparing: RecordingSessionState = {
      state: RecordingState.PREPARE,
      status: RecordingStatus.PROCESSING,
    };

    const starting = recordingSessionReducer(preparing, {
      state: RecordingState.PREPARE,
      status: RecordingStatus.COMPLETED,
    });
    const recording = recordingSessionReducer(starting, {
      state: RecordingState.RECORD,
      status: RecordingStatus.COMPLETED,
    });
    const pausing = recordingSessionReducer(recording, {
      state: RecordingState.PAUSE,
      status: RecordingStatus.REQUESTED,
    });
    const paused = recordingSessionReducer(pausing, {
      state: RecordingState.PAUSE,
      status: RecordingStatus.COMPLETED,
    });
    const resuming = recordingSessionReducer(paused, {
      state: RecordingState.RECORD,
      status: RecordingStatus.REQUESTED,
    });
    const resumed = recordingSessionReducer(resuming, {
      state: RecordingState.RECORD,
      status: RecordingStatus.COMPLETED,
    });
    const stopping = recordingSessionReducer(resumed, {
      state: RecordingState.STOP,
      status: RecordingStatus.REQUESTED,
    });
    const stopped = recordingSessionReducer(stopping, {
      state: RecordingState.STOP,
      status: RecordingStatus.COMPLETED,
      candidate,
    });

    expect(starting).toEqual({
      state: RecordingState.RECORD,
      status: RecordingStatus.PROCESSING,
    });
    expect(recording).toEqual({
      state: RecordingState.RECORD,
      status: RecordingStatus.COMPLETED,
    });
    expect(pausing).toEqual({
      state: RecordingState.PAUSE,
      status: RecordingStatus.PROCESSING,
    });
    expect(paused).toEqual({
      state: RecordingState.PAUSE,
      status: RecordingStatus.COMPLETED,
    });
    expect(resuming).toEqual({
      state: RecordingState.RECORD,
      status: RecordingStatus.PROCESSING,
    });
    expect(resumed).toEqual(recording);
    expect(stopping).toEqual({
      state: RecordingState.STOP,
      status: RecordingStatus.PROCESSING,
    });
    expect(stopped).toEqual({
      state: RecordingState.STOP,
      status: RecordingStatus.COMPLETED,
      candidate,
    });
  });

  it('일시정지 상태에서도 바로 종료를 요청할 수 있다', () => {
    const paused: RecordingSessionState = {
      state: RecordingState.PAUSE,
      status: RecordingStatus.COMPLETED,
    };

    expect(
      recordingSessionReducer(paused, {
        state: RecordingState.STOP,
        status: RecordingStatus.REQUESTED,
      }),
    ).toEqual({
      state: RecordingState.STOP,
      status: RecordingStatus.PROCESSING,
    });
  });

  it('허용하지 않은 요청과 늦은 완료는 현재 상태 객체를 유지한다', () => {
    const cases = [
      {
        name: '준비 중 stop 요청',
        state: {
          state: RecordingState.PREPARE,
          status: RecordingStatus.PROCESSING,
        } as RecordingSessionState,
        event: {
          state: RecordingState.STOP,
          status: RecordingStatus.REQUESTED,
        } as RecordingSessionEvent,
      },
      {
        name: '녹음 시작 확인 전 pause 요청',
        state: {
          state: RecordingState.RECORD,
          status: RecordingStatus.PROCESSING,
        } as RecordingSessionState,
        event: {
          state: RecordingState.PAUSE,
          status: RecordingStatus.REQUESTED,
        } as RecordingSessionEvent,
      },
      {
        name: 'pause 처리 중 record 요청',
        state: {
          state: RecordingState.PAUSE,
          status: RecordingStatus.PROCESSING,
        } as RecordingSessionState,
        event: {
          state: RecordingState.RECORD,
          status: RecordingStatus.REQUESTED,
        } as RecordingSessionEvent,
      },
      {
        name: 'stop 처리 중 중복 stop 요청',
        state: {
          state: RecordingState.STOP,
          status: RecordingStatus.PROCESSING,
        } as RecordingSessionState,
        event: {
          state: RecordingState.STOP,
          status: RecordingStatus.REQUESTED,
        } as RecordingSessionEvent,
      },
      {
        name: '종료 뒤 늦은 record 요청',
        state: {
          state: RecordingState.STOP,
          status: RecordingStatus.COMPLETED,
          candidate,
        } as RecordingSessionState,
        event: {
          state: RecordingState.RECORD,
          status: RecordingStatus.REQUESTED,
        } as RecordingSessionEvent,
      },
      {
        name: '녹음 중 늦은 pause 완료',
        state: {
          state: RecordingState.RECORD,
          status: RecordingStatus.COMPLETED,
        } as RecordingSessionState,
        event: {
          state: RecordingState.PAUSE,
          status: RecordingStatus.COMPLETED,
        } as RecordingSessionEvent,
      },
    ];

    cases.forEach(({ name, state, event }) => {
      expect(recordingSessionReducer(state, event), name).toBe(state);
    });
  });

  it('처리 중이거나 실행 중인 같은 state의 FAILED는 최종 오류 상태가 된다', () => {
    const cases = [
      { state: RecordingState.PREPARE, status: RecordingStatus.PROCESSING },
      { state: RecordingState.RECORD, status: RecordingStatus.PROCESSING },
      { state: RecordingState.PAUSE, status: RecordingStatus.PROCESSING },
      { state: RecordingState.STOP, status: RecordingStatus.PROCESSING },
      { state: RecordingState.RECORD, status: RecordingStatus.COMPLETED },
      { state: RecordingState.PAUSE, status: RecordingStatus.COMPLETED },
    ];

    cases.forEach(({ state, status }) => {
      const current = { state, status } as RecordingSessionState;

      expect(
        recordingSessionReducer(current, {
          state,
          status: RecordingStatus.FAILED,
          message: 'recorder 실패',
        }),
      ).toEqual({
        state,
        status: RecordingStatus.FAILED,
        message: 'recorder 실패',
      });
    });
  });

  it('다른 state의 FAILED는 늦은 callback으로 보고 무시한다', () => {
    const recording: RecordingSessionState = {
      state: RecordingState.RECORD,
      status: RecordingStatus.COMPLETED,
    };

    expect(
      recordingSessionReducer(recording, {
        state: RecordingState.PAUSE,
        status: RecordingStatus.FAILED,
        message: '늦은 pause 실패',
      }),
    ).toBe(recording);
  });

  it('최종 오류 상태 FAILED 뒤에는 최초 message와 같은 상태 객체를 유지한다', () => {
    const failed: RecordingSessionState = {
      state: RecordingState.RECORD,
      status: RecordingStatus.FAILED,
      message: '최초 실패',
    };

    expect(
      recordingSessionReducer(failed, {
        state: RecordingState.RECORD,
        status: RecordingStatus.FAILED,
        message: '늦은 실패',
      }),
    ).toBe(failed);
    expect(
      recordingSessionReducer(failed, {
        state: RecordingState.STOP,
        status: RecordingStatus.REQUESTED,
      }),
    ).toBe(failed);
  });
});
