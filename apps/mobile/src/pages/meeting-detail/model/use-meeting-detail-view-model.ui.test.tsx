import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Meeting } from '@/entities/meeting';
import { MeetingNotFoundError, MeetingStatus } from '@/entities/meeting';
import type { Recording } from '@/entities/recording';
import type { MeetingDetailResult } from '@/features/get-meeting-detail';
import type { ImportResult, PendingImport } from '@/features/record-meeting';

import {
  useMeetingDetailViewModel,
  type UseMeetingDetailViewModelInput,
} from './use-meeting-detail-view-model';

const TIME_ZONE = 'Asia/Seoul';

// 테스트마다 쓰는 입력이 다르므로 기본값에 override만 덮어 호출한다.
function buildInput(
  overrides: Partial<UseMeetingDetailViewModelInput> = {},
): UseMeetingDetailViewModelInput {
  return {
    meetingId: 'meeting-1',
    timeZone: TIME_ZONE,
    loadMeetingDetail: jest.fn(() => new Promise<MeetingDetailResult>(() => {})),
    getPendingImport: jest.fn(() => undefined),
    consumePendingImport: jest.fn(),
    loadMeeting: jest.fn(),
    renameMeeting: jest.fn(),
    ...overrides,
  };
}

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
    // buildInput을 render 콜백 안에서 부르면 매 렌더마다 jest.fn() 기본값이 새로 생겨
    // useEffect 의존성이 계속 바뀌어 무한 재렌더링에 빠진다. render 밖에서 한 번만 만든다.
    const input = buildInput({ loadMeetingDetail });

    const { result, unmount } = await renderHook(() => useMeetingDetailViewModel(input));

    expect(result.current).toMatchObject({ viewModel: { kind: 'loading' }, recording: null });
    expect(loadMeetingDetail).toHaveBeenCalledTimes(1);
    expect(loadMeetingDetail).toHaveBeenCalledWith('meeting-1');

    await unmount();
  });

  it('ready 결과가 오면 표시값은 viewModel에, 녹음 Domain은 recording에 담긴다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());

    const input = buildInput({ loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    expect(result.current).toMatchObject({
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

    const input = buildInput({ loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

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

    const input = buildInput({ loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

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

    const input = buildInput({ loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

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

    const input = buildInput({ loadMeetingDetail });

    const { result, rerender, unmount } = await renderHook(
      ({ meetingId }: { meetingId: string }) => useMeetingDetailViewModel({ ...input, meetingId }),
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

    const input = buildInput({ loadMeetingDetail });

    const { result, rerender, unmount } = await renderHook(
      ({ meetingId }: { meetingId: string }) => useMeetingDetailViewModel({ ...input, meetingId }),
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

    const input = buildInput({ loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

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
      const input = buildInput({ loadMeetingDetail });

      const { result, unmount } = await renderHook(() => useMeetingDetailViewModel(input));

      await waitFor(() =>
        expect(result.current).toMatchObject({
          viewModel: { kind: 'error', message: '회의를 불러오지 못했습니다.' },
          recording: null,
        }),
      );

      await unmount();
    }
  });

  it('T-D1: getPendingImport가 undefined면 기존처럼 loading 뒤 load한다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const getPendingImport = jest.fn(() => undefined);

    const input = buildInput({ getPendingImport, loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    expect(loadMeetingDetail).toHaveBeenCalledWith('meeting-1');
  });

  it('T-D2: 가져오기가 끝나지 않았으면 첫 렌더부터 importing을 보여주고 load하지 않는다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const getPendingImport = jest.fn(() => ({
      title: '가져온 회의',
      createdAt: '2026-10-03T00:00:00.000Z',
      result: new Promise<ImportResult>(() => {}),
    }));

    const input = buildInput({ getPendingImport, loadMeetingDetail });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    expect(result.current.viewModel).toEqual({
      kind: 'importing',
      title: '가져온 회의',
      dateLabel: expect.any(String),
    });
    expect(loadMeetingDetail).not.toHaveBeenCalled();
  });

  it('T-D3: 가져오기가 saved로 끝나면 loading을 거치지 않고 importing에서 ready로 바뀌고 consume된다', async () => {
    const importResult = createDeferred<ImportResult>();
    const loadMeetingDetail = jest.fn(async () => buildReadyResult({ title: '가져온 회의' }));
    const getPendingImport = jest.fn(() => ({
      title: '가져온 회의',
      createdAt: '2026-10-03T00:00:00.000Z',
      result: importResult.promise,
    }));
    const consumePendingImport = jest.fn();
    const renderedKinds: string[] = [];

    const input = buildInput({ consumePendingImport, getPendingImport, loadMeetingDetail });

    const { result } = await renderHook(() => {
      const output = useMeetingDetailViewModel(input);

      renderedKinds.push(output.viewModel.kind);

      return output;
    });

    expect(result.current.viewModel.kind).toBe('importing');

    await act(async () => {
      importResult.resolve({ kind: 'saved', recording: baseRecording });
    });

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    expect(renderedKinds).not.toContain('loading');
    expect(loadMeetingDetail).toHaveBeenCalledWith('meeting-1');
    expect(consumePendingImport).toHaveBeenCalledWith('meeting-1');
    expect(consumePendingImport).toHaveBeenCalledTimes(1);
  });

  it('T-D4: 가져오기가 지원하지 않는 형식으로 끝나면 import-failed가 되고 load·consume하지 않으며 유지된다', async () => {
    const importResult = createDeferred<ImportResult>();
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const consumePendingImport = jest.fn();
    const getPendingImport = jest.fn<PendingImport | undefined, [string]>(() => ({
      title: '가져온 회의',
      createdAt: '2026-10-03T00:00:00.000Z',
      result: importResult.promise,
    }));

    const input = buildInput({ consumePendingImport, getPendingImport, loadMeetingDetail });

    const { result, rerender } = await renderHook(
      (_props: Record<string, never>) => useMeetingDetailViewModel(input),
      { initialProps: {} },
    );

    await act(async () => {
      importResult.resolve({ kind: 'unsupported' });
    });

    await waitFor(() => expect(result.current.viewModel.kind).toBe('import-failed'));

    expect(loadMeetingDetail).not.toHaveBeenCalled();
    expect(consumePendingImport).not.toHaveBeenCalled();

    // 목록이 이미 consume해 다음부터는 undefined를 주더라도 import-failed를 유지한다.
    getPendingImport.mockReturnValue(undefined);

    await rerender({});

    expect(result.current.viewModel.kind).toBe('import-failed');
    expect(loadMeetingDetail).not.toHaveBeenCalled();
  });

  it('T-R3: ready 상태에서 rename하면 renameMeeting·loadMeeting을 호출하고 title만 바뀌며 recording 참조는 유지된다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const renameMeeting = jest.fn(async () => {});
    const loadMeeting = jest.fn(async () => ({ ...baseMeeting, title: '새 제목' }));

    const input = buildInput({ loadMeeting, loadMeetingDetail, renameMeeting });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    const recordingBeforeRename = result.current.recording;

    await act(async () => {
      await result.current.rename('새 제목');
    });

    expect(renameMeeting).toHaveBeenCalledWith('meeting-1', '새 제목');
    expect(loadMeeting).toHaveBeenCalledWith('meeting-1');
    expect(result.current.viewModel).toMatchObject({ title: '새 제목' });
    expect(result.current.recording).toBe(recordingBeforeRename);
  });

  it('rename이 MeetingNotFoundError로 실패하면 renameNotFound 문구로 reject하고 title은 바뀌지 않는다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const renameMeeting = jest.fn(async () => {
      throw new MeetingNotFoundError('없음');
    });
    const loadMeeting = jest.fn();

    const input = buildInput({ loadMeeting, loadMeetingDetail, renameMeeting });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    await expect(result.current.rename('새 제목')).rejects.toThrow('회의를 찾을 수 없습니다.');
    expect(result.current.viewModel).toMatchObject({ title: '제품 회의' });
  });

  it('rename이 일반 오류로 실패하면 renameFailed 문구로 reject하고 title은 바뀌지 않는다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const renameMeeting = jest.fn(async () => {
      throw new Error('DB 오류');
    });
    const loadMeeting = jest.fn();

    const input = buildInput({ loadMeeting, loadMeetingDetail, renameMeeting });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    await expect(result.current.rename('새 제목')).rejects.toThrow('제목을 저장하지 못했습니다.');
    expect(result.current.viewModel).toMatchObject({ title: '제품 회의' });
  });

  it('rename 뒤 loadMeeting이 null이면 renameNotFound 문구로 reject하고 title은 바뀌지 않는다', async () => {
    const loadMeetingDetail = jest.fn(async () => buildReadyResult());
    const renameMeeting = jest.fn(async () => {});
    const loadMeeting = jest.fn(async () => null);

    const input = buildInput({ loadMeeting, loadMeetingDetail, renameMeeting });

    const { result } = await renderHook(() => useMeetingDetailViewModel(input));

    await waitFor(() => expect(result.current.viewModel.kind).toBe('ready'));

    await expect(result.current.rename('새 제목')).rejects.toThrow('회의를 찾을 수 없습니다.');
    expect(result.current.viewModel).toMatchObject({ title: '제품 회의' });
  });
});
