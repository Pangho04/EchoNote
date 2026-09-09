import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Recording } from '@/entities/recording/model/recording';

import type {
  RecordingService,
  StoppedRecordingCandidate,
} from '../api/recording-service-contract';
import { clearRecordingDraft } from './recording-draft';
import { type RecordingSessionDependencies, useRecordingSession } from './use-recording-session';

const candidate: StoppedRecordingCandidate = { tempUri: 'file:///temp/m1.m4a', durationMs: 5000 };
const saved: Recording = {
  meetingId: 'm1',
  uri: 'file:///final/m1.m4a',
  mimeType: 'audio/mp4',
  sha256: 'abc',
  durationMs: 5000,
  byteSize: 123,
};

function makeRecorder() {
  const service: RecordingService = {
    prepare: jest.fn(async () => undefined),
    record: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    stop: jest.fn(async () => candidate),
    subscribe: jest.fn(() => () => undefined),
    dispose: jest.fn(async () => undefined),
  };

  return {
    service,
    prepare: service.prepare as jest.Mock,
    record: service.record as jest.Mock,
    stop: service.stop as jest.Mock,
  };
}

function makeDeps(
  overrides: Partial<RecordingSessionDependencies> = {},
): RecordingSessionDependencies {
  return {
    now: jest.fn(() => '2026-08-08T00:00:00.000Z'),
    getCurrentTimeZone: jest.fn(() => 'Asia/Seoul'),
    saveRecording: jest.fn(async () => saved),
    getSavedByMeetingId: jest.fn(async () => null),
    ...overrides,
  };
}

async function bind(service: RecordingService, deps: RecordingSessionDependencies) {
  return await renderHook(() =>
    useRecordingSession({
      meetingId: 'm1',
      draftTitle: '제목',
      recordingService: service,
      dependencies: deps,
    }),
  );
}

describe('useRecordingSession', () => {
  beforeEach(() => {
    clearRecordingDraft('m1');
  });

  it('mount 뒤 prepare·record가 자동 실행되어 녹음 안정 상태가 된다', async () => {
    const { service, prepare, record } = makeRecorder();
    const { result } = await bind(service, makeDeps());

    await waitFor(() => expect(prepare).toHaveBeenCalled());
    await waitFor(() => expect(record).toHaveBeenCalled());
    await waitFor(() => expect(result.current.canPause).toBe(true));
    expect(result.current.canResume).toBe(false);
  });

  it('일시정지 후 재개해도 경과 시간이 이어진다', async () => {
    jest.useFakeTimers();

    try {
      const { service } = makeRecorder();
      const { result } = await bind(service, makeDeps());

      await waitFor(() => expect(result.current.canPause).toBe(true));

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      const pausedAtMs = result.current.elapsedMs;

      expect(pausedAtMs).toBeGreaterThanOrEqual(2000);

      await act(async () => {
        await result.current.pause();
      });
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.elapsedMs).toBe(pausedAtMs);

      await act(async () => {
        await result.current.resume();
      });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(pausedAtMs + 1000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stop 후 candidate를 저장하고 saved로 전이한다', async () => {
    const { service, stop } = makeRecorder();
    const deps = makeDeps();
    const { result } = await bind(service, deps);

    await waitFor(() => expect(result.current.canPause).toBe(true));

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.saveRecording).toHaveBeenCalledTimes(1);
    expect(result.current.savedRecording).toEqual(saved);
  });

  it('저장 실패 시 failed로, 재시도로 saved에 수렴한다', async () => {
    const { service } = makeRecorder();
    const saveRecording = jest
      .fn(async () => saved)
      .mockRejectedValueOnce(new Error('db fail'))
      .mockResolvedValueOnce(saved);
    const deps = makeDeps({ saveRecording });
    const { result } = await bind(service, deps);

    await waitFor(() => expect(result.current.canPause).toBe(true));

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.errorMessage).toBe('db fail');

    await act(async () => {
      result.current.retrySave();
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(saveRecording).toHaveBeenCalledTimes(2);
  });

  it('중복 stop으로 native stop이 여러 번 이어도 저장은 한 번만 실행한다', async () => {
    const { service, stop } = makeRecorder();
    const deps = makeDeps();
    const { result } = await bind(service, deps);

    await waitFor(() => expect(result.current.canPause).toBe(true));

    await act(async () => {
      await result.current.stop();
      await result.current.stop();
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(deps.saveRecording).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
