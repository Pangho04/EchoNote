import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createSQLiteMeetingRepository, toMeetingListItemVM } from '@/entities/meeting';
import { useSession } from '@/features/authenticate';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingPermissionService } from '@/features/record-meeting';
import { startRecording } from '@/features/record-meeting';

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
}));
jest.mock('@/features/list-meetings', () => ({
  makeListMeetings: jest.fn(),
}));
jest.mock('@/features/record-meeting', () => ({
  startRecording: jest.fn(),
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedUseSession = jest.mocked(useSession);
const mockedCreateRepository = jest.mocked(createSQLiteMeetingRepository);
const mockedToMeetingListItemVM = jest.mocked(toMeetingListItemVM);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);
const mockedStartRecording = jest.mocked(startRecording);

const permissionService: RecordingPermissionService = {
  get: jest.fn(),
  request: jest.fn(),
  openSettings: jest.fn(),
  requestBackgroundRecording: jest.fn(),
};

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
    list: listMeetings,
  });
  mockedMakeListMeetings.mockReturnValue(listMeetings);

  return listMeetings;
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

  it('granted 결과를 그대로 반환한다', async () => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind: 'granted', meetingId: 'meeting-id' });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
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
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
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
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
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
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
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
});
