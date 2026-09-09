import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createSQLiteMeetingRepository, toMeetingListItemVM } from '@/entities/meeting';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingPermissionService } from '@/features/record-meeting';
import { startRecording } from '@/features/record-meeting';

// 배럴을 jest.mock으로 갈아끼웠으므로 실제 MeetingStatus는 model 모듈에서 직접 가져온다.
import { type Meeting, MeetingStatus } from '../../../entities/meeting/model/meeting';
import { useMeetingLibraryViewModel } from './use-meeting-library-view-model';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
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
const mockedCreateRepository = jest.mocked(createSQLiteMeetingRepository);
const mockedToMeetingListItemVM = jest.mocked(toMeetingListItemVM);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);
const mockedStartRecording = jest.mocked(startRecording);

const permissionService: RecordingPermissionService = {
  get: jest.fn(),
  request: jest.fn(),
  openSettings: jest.fn(),
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

  it('blocked면 dialog를 열어 둔 채 설정 안내를 노출한다', async () => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind: 'blocked' });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
    );

    await act(async () => {
      result.current.openRecordingTitleDialog();
    });

    await act(async () => {
      await result.current.confirmRecordingTitle('제목');
    });

    expect(result.current.isTitleDialogOpen).toBe(true);
    expect(result.current.permissionMessage).toBe('설정에서 마이크 권한을 허용해 주세요.');
    expect(result.current.isPermissionBlocked).toBe(true);
  });

  it('denied면 dialog를 열어 둔 채 재시도 안내를 노출한다', async () => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind: 'denied' });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
    );

    await act(async () => {
      result.current.openRecordingTitleDialog();
    });

    await act(async () => {
      await result.current.confirmRecordingTitle('제목');
    });

    expect(result.current.isTitleDialogOpen).toBe(true);
    expect(result.current.permissionMessage).toBe(
      '마이크 권한을 허용해야 녹음을 시작할 수 있습니다.',
    );
    expect(result.current.isPermissionBlocked).toBe(false);
  });

  it('granted면 dialog를 닫는다', async () => {
    setupMeetings(null);
    mockedStartRecording.mockResolvedValue({ kind: 'granted', meetingId: 'meeting-id' });

    const { result } = await renderHook(() =>
      useMeetingLibraryViewModel(permissionService, () => 'm1'),
    );

    await act(async () => {
      result.current.openRecordingTitleDialog();
    });

    await act(async () => {
      await result.current.confirmRecordingTitle('제목');
    });

    expect(result.current.isTitleDialogOpen).toBe(false);
    expect(result.current.permissionMessage).toBeNull();
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
      accessory: { kind: 'disclosure' },
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
});
