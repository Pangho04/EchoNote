import { MAX_UPLOAD_BYTES } from '@echonote/contracts';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createSQLiteMeetingRepository, toMeetingListItemVM } from '@/entities/meeting';
import type { Recording } from '@/entities/recording';
import { useSession } from '@/features/authenticate';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingImportService, RecordingPermissionService } from '@/features/record-meeting';
import { importRecording, pendingImports, startRecording } from '@/features/record-meeting';
import { UI_STRINGS } from '@/shared/config/ui-strings';

// 배럴을 jest.mock으로 갈아끼웠으므로 실제 MeetingStatus는 model 모듈에서 직접 가져온다.
import { type Meeting, MeetingStatus } from '../../../entities/meeting/model/meeting';
import { useMeetingLibraryViewModel } from './use-meeting-library-view-model';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));
jest.mock('@/features/authenticate', () => ({
  useSession: jest.fn(),
}));
jest.mock('@/entities/meeting', () => ({
  createSQLiteMeetingRepository: jest.fn(),
  toMeetingListItemVM: jest.fn(),
  nomalizeMeetingTitle: jest.fn(() => '새 녹음'),
}));
jest.mock('@/features/list-meetings', () => ({
  makeListMeetings: jest.fn(),
}));
jest.mock('@/features/record-meeting', () => {
  const actual = jest.requireActual('@/features/record-meeting');

  return {
    startRecording: jest.fn(),
    importRecording: jest.fn(),
    isAllowedRecordingMimeType: jest.fn(() => true),
    pendingImports: actual.pendingImports,
  };
});
jest.mock('@/features/record-meeting/api/recording-file-service.native', () => ({
  createNativeRecordingFileService: jest.fn(() => ({
    exists: jest.fn(),
    inspect: jest.fn(),
    move: jest.fn(),
    delete: jest.fn(),
  })),
  createFinalRecordingUri: jest.fn(() => 'file:///final.m4a'),
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedUseSession = jest.mocked(useSession);
const mockedCreateRepository = jest.mocked(createSQLiteMeetingRepository);
const mockedToMeetingListItemVM = jest.mocked(toMeetingListItemVM);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);
const mockedStartRecording = jest.mocked(startRecording);
const mockedImportRecording = jest.mocked(importRecording);

const permissionService: RecordingPermissionService = {
  get: jest.fn(),
  request: jest.fn(),
  openSettings: jest.fn(),
  requestBackgroundRecording: jest.fn(),
};

function createImportService(): jest.Mocked<RecordingImportService> {
  return {
    pickRecording: jest.fn(),
    copyToCache: jest.fn(),
    readHeaderBytes: jest.fn(),
    readDurationMs: jest.fn(),
  };
}

function setupMeetings(meeting: Meeting | null) {
  const listMeetings = jest.fn(async () => ({
    meetings: meeting ? [meeting] : [],
    nextCursor: null,
    timeZone: 'Asia/Seoul',
  }));

  mockedUseSQLiteContext.mockReturnValue({} as ReturnType<typeof useSQLiteContext>);
  mockedCreateRepository.mockReturnValue({
    create: jest.fn(),
    getByMeetingId: jest.fn(),
    rename: jest.fn(),
    list: listMeetings,
  });
  mockedMakeListMeetings.mockReturnValue(listMeetings);

  return listMeetings;
}

// pendingImports는 모듈 singleton이라 테스트가 남긴 항목을 다음 테스트가 보지 않도록 끝에 치운다.
function consumeAllPendingImports() {
  for (const failure of pendingImports.failures()) pendingImports.consume(failure.meetingId);
}

describe('useMeetingLibraryViewModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSession.mockReturnValue({
      state: { kind: 'signedIn' },
      signIn: jest.fn(),
      signOut: jest.fn(),
    } as unknown as ReturnType<typeof useSession>);
  });

  afterEach(() => {
    consumeAllPendingImports();
  });

  it('granted 결과를 그대로 반환한다', async () => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind: 'granted', meetingId: 'meeting-id' });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
    );

    let outcome: Awaited<ReturnType<typeof result.current.confirmRecordingTitle>> | undefined;

    await act(async () => {
      outcome = await result.current.confirmRecordingTitle('제목');
    });

    expect(mockedStartRecording).toHaveBeenCalledWith(
      permissionService,
      '제목',
      expect.any(Function),
    );
    expect(outcome).toEqual({ kind: 'granted', meetingId: 'meeting-id' });
  });

  it.each([['blocked'], ['denied']] as const)('%s 결과를 그대로 반환한다', async (kind) => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
    );

    let outcome: Awaited<ReturnType<typeof result.current.confirmRecordingTitle>> | undefined;

    await act(async () => {
      outcome = await result.current.confirmRecordingTitle('제목');
    });

    expect(outcome).toEqual({ kind });
  });

  it('refresh가 끝나면 목록을 보여준다', async () => {
    const meeting: Meeting = {
      id: 'meeting-1',
      title: '제품 회의',
      status: MeetingStatus.LocalOnly,
      createdAt: '2026-08-08T00:10:00.000Z',
      updatedAt: '2026-08-08T00:10:00.000Z',
      durationMs: null,
    };
    const listMeetings = setupMeetings(meeting);

    mockedToMeetingListItemVM.mockReturnValue({
      id: 'meeting-1',
      title: '제품 회의',
      monthLabel: '8월',
      dayLabel: '08',
      metaLabel: '녹음 대기',
      accessory: { kind: 'arrow' },
    });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
    );

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(listMeetings).toHaveBeenCalledTimes(1);
  });

  it('조회가 실패하면 원인 문구 대신 고정 안내를 남기고 clearErrorMessage로 지운다', async () => {
    setupMeetings(null);
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      }),
    );

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
    );

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() =>
      expect(result.current.errorMessage).toBe('회의 목록을 불러오지 못했습니다.'),
    );

    await act(async () => {
      result.current.clearErrorMessage();
    });

    expect(result.current.errorMessage).toBeNull();
  });

  describe('pickAndImport', () => {
    it('picker에서 취소하면 canceled를 반환하고 가져오기를 시작하지 않는다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      importService.pickRecording.mockResolvedValue(null);

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', importService, true),
      );

      let outcome: Awaited<ReturnType<typeof result.current.pickAndImport>> | undefined;

      await act(async () => {
        outcome = await result.current.pickAndImport();
      });

      expect(outcome).toEqual({ kind: 'canceled' });
      expect(mockedImportRecording).not.toHaveBeenCalled();
      expect(pendingImports.failures()).toHaveLength(0);
    });

    it('512MB를 넘으면 tooLarge를 반환하고 가져오기를 시작하지 않는다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      importService.pickRecording.mockResolvedValue({
        uri: 'file:///big.m4a',
        size: MAX_UPLOAD_BYTES + 1,
      });

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', importService, true),
      );

      let outcome: Awaited<ReturnType<typeof result.current.pickAndImport>> | undefined;

      await act(async () => {
        outcome = await result.current.pickAndImport();
      });

      expect(outcome).toEqual({ kind: 'tooLarge' });
      expect(mockedImportRecording).not.toHaveBeenCalled();
    });

    it('크기를 모르는 파일(size 0)은 통과시켜 가져오기를 시작한다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      importService.pickRecording.mockResolvedValue({ uri: 'file:///unknown.m4a', size: 0 });
      mockedImportRecording.mockResolvedValue({
        kind: 'saved',
        recording: {} as unknown as Recording,
      });

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'size-zero', importService, true),
      );

      let outcome: Awaited<ReturnType<typeof result.current.pickAndImport>> | undefined;

      await act(async () => {
        outcome = await result.current.pickAndImport();
      });

      expect(outcome).toEqual({ kind: 'started', meetingId: 'size-zero' });
    });

    // 실제 picker는 자체 오류를 취소로 바꿔 돌려주므로 이 경로는 시작 단계의 앱 쪽 예외다.
    it('시작 단계에서 예외가 나면 failed를 반환하고 isImporting을 되돌린다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      importService.pickRecording.mockRejectedValue(new Error('picker crashed'));

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', importService, true),
      );

      let outcome: Awaited<ReturnType<typeof result.current.pickAndImport>> | undefined;

      await act(async () => {
        outcome = await result.current.pickAndImport();
      });

      expect(outcome).toEqual({ kind: 'failed' });
      expect(result.current.isImporting).toBe(false);
    });

    it('크기가 괜찮으면 started를 반환하고 가져오기를 pendingImports에 등록한다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      importService.pickRecording.mockResolvedValue({ uri: 'file:///a.m4a', size: 100 });
      mockedImportRecording.mockResolvedValue({
        kind: 'saved',
        recording: {} as unknown as Recording,
      });

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'started-meeting', importService, true),
      );

      let outcome: Awaited<ReturnType<typeof result.current.pickAndImport>> | undefined;

      await act(async () => {
        outcome = await result.current.pickAndImport();
      });

      expect(outcome).toEqual({ kind: 'started', meetingId: 'started-meeting' });

      await waitFor(() => expect(mockedImportRecording).toHaveBeenCalledTimes(1));
    });

    it('가져오는 동안 다시 호출하면 canceled를 반환해 겹치지 않게 막는다', async () => {
      setupMeetings(null);

      const importService = createImportService();
      let resolvePick: (value: { uri: string; size: number } | null) => void = () => {};
      importService.pickRecording.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePick = resolve;
          }),
      );

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', importService, true),
      );

      // 같은 프레임의 연타는 다시 렌더되기 전이라 같은 함수를 두 번 부른다.
      const pickAndImport = result.current.pickAndImport;
      let firstCall: Promise<Awaited<ReturnType<typeof result.current.pickAndImport>>>;

      await act(async () => {
        firstCall = pickAndImport();
      });

      const secondOutcome = await act(async () => pickAndImport());

      expect(secondOutcome).toEqual({ kind: 'canceled' });
      expect(importService.pickRecording).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolvePick(null);
        await firstCall;
      });
    });
  });

  describe('importFailure', () => {
    it.each([
      ['tooLarge', UI_STRINGS.meetingLibrary.uploadTooLarge],
      ['unsupported', UI_STRINGS.meetingLibrary.uploadUnsupported],
      ['unreadable', UI_STRINGS.meetingLibrary.uploadUnreadable],
      ['failed', UI_STRINGS.meetingLibrary.uploadFailed],
    ] as const)('%s 실패는 "%s" 문구로 알린다', async (kind, reason) => {
      setupMeetings(null);

      pendingImports.start('failure-meeting', {
        title: '실패한 회의',
        createdAt: '2026-08-08T00:10:00.000Z',
        importRecording: async () => ({ kind }),
      });

      await waitFor(() => expect(pendingImports.failures()).toHaveLength(1));

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
      );

      await waitFor(() =>
        expect(result.current.importFailure).toEqual({
          meetingId: 'failure-meeting',
          message: `실패한 회의\n${reason}`,
        }),
      );
    });

    it('포커스를 잃은 동안은 실패를 알리지 않고 복귀하면 알린다', async () => {
      setupMeetings(null);

      pendingImports.start('focus-meeting', {
        title: '포커스 회의',
        createdAt: '2026-08-08T00:10:00.000Z',
        importRecording: async () => ({ kind: 'failed' }),
      });

      await waitFor(() => expect(pendingImports.failures()).toHaveLength(1));

      const { result, rerender } = await renderHook(
        ({ isFocused }: { isFocused: boolean }) =>
          useMeetingLibraryViewModel(
            permissionService,
            () => 'm1',
            createImportService(),
            isFocused,
          ),
        { initialProps: { isFocused: false } },
      );

      expect(result.current.importFailure).toBeNull();

      rerender({ isFocused: true });

      await waitFor(() =>
        expect(result.current.importFailure).toEqual({
          meetingId: 'focus-meeting',
          message: `포커스 회의\n${UI_STRINGS.meetingLibrary.uploadFailed}`,
        }),
      );
    });
  });

  it('T-I8: 포커스 중일 때만 가져오기 settle에 맞춰 목록을 다시 읽는다', async () => {
    const listMeetings = setupMeetings(null);

    const { result, rerender } = await renderHook(
      ({ isFocused }: { isFocused: boolean }) =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), isFocused),
      { initialProps: { isFocused: false } },
    );

    await act(async () => {
      await result.current.refresh();
    });

    listMeetings.mockClear();

    pendingImports.start('unfocused-meeting', {
      title: '포커스 밖 회의',
      createdAt: '2026-08-08T00:10:00.000Z',
      importRecording: async () => ({ kind: 'failed' }),
    });

    await waitFor(() => expect(pendingImports.failures()).toHaveLength(1));
    expect(listMeetings).not.toHaveBeenCalled();

    rerender({ isFocused: true });

    pendingImports.consume('unfocused-meeting');

    pendingImports.start('focused-meeting', {
      title: '포커스 중 회의',
      createdAt: '2026-08-08T00:10:00.000Z',
      importRecording: async () => ({ kind: 'failed' }),
    });

    await waitFor(() => expect(listMeetings).toHaveBeenCalled());
  });

  describe('dismissImportFailure', () => {
    it('치우면 pendingImports에서 지우고 다음 실패로 넘어간다', async () => {
      setupMeetings(null);

      pendingImports.start('first-meeting', {
        title: '첫 실패',
        createdAt: '2026-08-08T00:10:00.000Z',
        importRecording: async () => ({ kind: 'failed' }),
      });

      await waitFor(() => expect(pendingImports.failures()).toHaveLength(1));

      const { result } = await renderHook(() =>
        useMeetingLibraryViewModel(permissionService, () => 'm1', createImportService(), true),
      );

      await waitFor(() => expect(result.current.importFailure?.meetingId).toBe('first-meeting'));

      await act(async () => {
        result.current.dismissImportFailure('first-meeting');
      });

      expect(pendingImports.failures()).toHaveLength(0);
      await waitFor(() => expect(result.current.importFailure).toBeNull());
    });
  });
});
