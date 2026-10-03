import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Meeting } from '@/entities/meeting';
import { MeetingStatus } from '@/entities/meeting';
import type { Recording } from '@/entities/recording';
import type { MeetingDetailResult } from '@/features/get-meeting-detail';

import { useMeetingDetailViewModel } from './use-meeting-detail-view-model';

const TIME_ZONE = 'Asia/Seoul';

const baseMeeting: Meeting = {
  id: 'meeting-1',
  title: '제품 회의',
  status: MeetingStatus.Completed,
  createdAt: '2026-08-04T01:00:00.000Z',
  updatedAt: '2026-08-04T01:00:00.000Z',
  durationMs: 3_134_000,
};

const baseRecording: Recording = {
  meetingId: 'meeting-1',
  uri: 'file://recording.m4a',
  mimeType: 'audio/m4a',
  sha256: 'sha256',
  durationMs: 3_134_000,
  byteSize: 1_000,
};

function buildReadyResult(
  meetingOverrides: Partial<Meeting> = {},
  recordingOverrides: Partial<Recording> = {},
): MeetingDetailResult {
  return {
    kind: 'ready',
    meeting: { ...baseMeeting, ...meetingOverrides },
    recording: { ...baseRecording, ...recordingOverrides },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('useMeetingDetailViewModel', () => {
  it('첫 렌더는 loading이고 loadMeetingDetail가 meetingId로 1회 호출된다', async () => {
    const loadMeetingDetail = jest.fn(() => new Promise<MeetingDetailResult>(() => {}));

    const { result, unmount } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    expect(result.current).toEqual({ viewModel: { kind: 'loading' }, recording: null });
    expect(loadMeetingDetail).toHaveBeenCalledTimes(1);
    expect(loadMeetingDetail).toHaveBeenCalledWith('meeting-1');

    await unmount();
  });

  it('ready 결과가 오면 표시값은 viewModel에, 녹음 Domain은 recording에 담긴다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());

    const { result } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    expect(result.current).toEqual({
      viewModel: {
        kind: 'ready',
        title: '제품 회의',
        dateLabel: '2026년 8월 4일 · 오전 10:00',
        durationLabel: '52분 14초',
      },
      recording: baseRecording,
    });
  });

  it('not-found 결과는 회의를 찾을 수 없다는 안내가 된다', async () => {
    const loadMeetingDetail = jest.fn(
      async () => ({ kind: 'not-found' }) satisfies MeetingDetailResult,
    );

    const { result } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    await waitFor(() =>
      expect(result.current.viewModel).toEqual({
        kind: 'not-found',
        message: '회의를 찾을 수 없습니다.',
      }),
    );
  });

  it('recording-missing 결과는 녹음 파일을 찾을 수 없다는 안내가 된다', async () => {
    const loadMeetingDetail = jest.fn(
      async () => ({ kind: 'recording-missing' }) satisfies MeetingDetailResult,
    );

    const { result } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    await waitFor(() =>
      expect(result.current.viewModel).toEqual({
        kind: 'recording-missing',
        message: '녹음 파일을 찾을 수 없습니다.',
      }),
    );
  });

  it('error 결과는 기능이 준 원인 문구 대신 고정된 안내 문구가 된다', async () => {
    const loadMeetingDetail = jest.fn(
      async () => ({ kind: 'error', message: 'DB가 깨졌습니다' }) satisfies MeetingDetailResult,
    );

    const { result } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    await waitFor(() =>
      expect(result.current.viewModel).toEqual({
        kind: 'error',
        message: '회의를 불러오지 못했습니다.',
      }),
    );
  });

  it('먼저 시작한 요청이 늦게 resolve해도 최신 결과만 반영된다', async () => {
    const staleRequest = createDeferred<MeetingDetailResult>();
    const freshRequest = createDeferred<MeetingDetailResult>();
    const loadMeetingDetail = jest
      .fn<Promise<MeetingDetailResult>, [string]>()
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise);

    const { result, rerender, unmount } = await renderHook(
      ({ meetingId }: { meetingId: string }) =>
        useMeetingDetailViewModel({ meetingId, timeZone: TIME_ZONE, loadMeetingDetail }),
      { initialProps: { meetingId: 'meeting-1' } },
    );

    await rerender({ meetingId: 'meeting-2' });

    expect(result.current.viewModel).toEqual({ kind: 'loading' });

    await act(async () => {
      freshRequest.resolve(buildReadyResult({ title: '두 번째 회의' }));
    });

    expect(result.current.viewModel).toMatchObject({ kind: 'ready', title: '두 번째 회의' });

    await act(async () => {
      staleRequest.resolve(buildReadyResult({ title: '첫 번째 회의' }));
    });

    expect(result.current.viewModel).toMatchObject({ kind: 'ready', title: '두 번째 회의' });

    await unmount();
  });

  it('이미 결과가 표시된 뒤 meetingId가 바뀌면 이전 회의를 남기지 않고 loading으로 돌아간다', async () => {
    const firstRequest = createDeferred<MeetingDetailResult>();
    const secondRequest = createDeferred<MeetingDetailResult>();
    const loadMeetingDetail = jest
      .fn<Promise<MeetingDetailResult>, [string]>()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    const { result, rerender, unmount } = await renderHook(
      ({ meetingId }: { meetingId: string }) =>
        useMeetingDetailViewModel({ meetingId, timeZone: TIME_ZONE, loadMeetingDetail }),
      { initialProps: { meetingId: 'meeting-1' } },
    );

    await act(async () => {
      firstRequest.resolve(buildReadyResult({ title: '첫 번째 회의' }));
    });

    expect(result.current.viewModel).toMatchObject({ kind: 'ready', title: '첫 번째 회의' });

    await rerender({ meetingId: 'meeting-2' });

    // 두 번째 요청이 아직 끝나지 않았어도 이전 회의가 남아 있으면 안 된다.
    expect(result.current.viewModel).toEqual({ kind: 'loading' });

    await unmount();
  });

  it.each([
    [0, '0초'],
    [59_999, '59초'],
    [3_134_000, '52분 14초'],
    [60_000, '1분'],
    [3_600_000, '1시간'],
    [3_660_000, '1시간 1분'],
    [3_601_000, '1시간 1초'],
  ])('durationMs가 %d이면 durationLabel은 "%s"이다', async (durationMs, expectedDurationLabel) => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult({}, { durationMs }));

    const { result } = await renderHook(() =>
      useMeetingDetailViewModel({ meetingId: 'meeting-1', timeZone: TIME_ZONE, loadMeetingDetail }),
    );

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    expect(result.current.viewModel).toMatchObject({ durationLabel: expectedDurationLabel });
  });

  it('createdAt이 잘못됐거나 durationMs가 비정상이거나 loadMeetingDetail가 reject해도 error VM이 되고 렌더는 throw하지 않는다', async () => {
    const invalidCreatedAt = jest.fn(async () => buildReadyResult({ createdAt: 'invalid-date' }));
    const negativeDuration = jest.fn(async () => buildReadyResult({}, { durationMs: -1 }));
    const nanDuration = jest.fn(async () => buildReadyResult({}, { durationMs: NaN }));
    const infiniteDuration = jest.fn(async () => buildReadyResult({}, { durationMs: Infinity }));
    const rejectingLoad = jest.fn(async () => {
      throw new Error('DB 연결 실패');
    });

    for (const loadMeetingDetail of [
      invalidCreatedAt,
      negativeDuration,
      nanDuration,
      infiniteDuration,
      rejectingLoad,
    ]) {
      const { result, unmount } = await renderHook(() =>
        useMeetingDetailViewModel({
          meetingId: 'meeting-1',
          timeZone: TIME_ZONE,
          loadMeetingDetail,
        }),
      );

      await waitFor(() =>
        expect(result.current).toEqual({
          viewModel: { kind: 'error', message: '회의를 불러오지 못했습니다.' },
          recording: null,
        }),
      );

      await unmount();
    }
  });
});
