import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { createSQLiteMeetingRepository, toMeetingListItemVM } from '@/entities/meeting';
import { makeCreateMeeting } from '@/features/create-meeting';
import { makeListMeetings } from '@/features/list-meetings';

import { type Meeting, MeetingStatus } from '../../../entities/meeting/model/meeting';
import { useMeetingLibraryViewModel } from './use-meeting-library-view-model';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));
jest.mock('@/entities/meeting', () => ({
  createSQLiteMeetingRepository: jest.fn(),
  toMeetingListItemVM: jest.fn(),
}));
jest.mock('@/features/create-meeting', () => ({
  makeCreateMeeting: jest.fn(),
}));
jest.mock('@/features/list-meetings', () => ({
  makeListMeetings: jest.fn(),
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedCreateRepository = jest.mocked(createSQLiteMeetingRepository);
const mockedToMeetingListItemVM = jest.mocked(toMeetingListItemVM);
const mockedMakeCreateMeeting = jest.mocked(makeCreateMeeting);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);

describe('useMeetingLibraryViewModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('회의 생성 commit 뒤 목록을 다시 조회한다', async () => {
    const repository = { create: jest.fn(), list: jest.fn() };
    const meeting: Meeting = {
      id: 'meeting-1',
      title: '제품 회의',
      status: MeetingStatus.LocalOnly,
      startedAt: '2026-08-08T00:10:00.000Z',
      createdAt: '2026-08-08T00:10:00.000Z',
      updatedAt: '2026-08-08T00:10:00.000Z',
      durationMs: null,
    };
    let resolveCreate: ((createdMeeting: Meeting) => void) | undefined;
    const createMeeting = jest.fn(
      () =>
        new Promise<Meeting>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const emptyResult: { meetings: Meeting[]; nextCursor: null; timeZone: string } = {
      meetings: [],
      nextCursor: null,
      timeZone: 'Asia/Seoul',
    };
    const listMeetings = jest
      .fn(async () => emptyResult)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({
        meetings: [meeting],
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      });

    mockedUseSQLiteContext.mockReturnValue({} as ReturnType<typeof useSQLiteContext>);
    mockedCreateRepository.mockReturnValue(repository);
    mockedMakeCreateMeeting.mockReturnValue(createMeeting);
    mockedMakeListMeetings.mockReturnValue(listMeetings);
    mockedToMeetingListItemVM.mockImplementation((source) => ({
      id: source.id,
      title: source.title,
      monthLabel: '8월',
      dayLabel: '08',
      metaLabel: '녹음 대기',
      statusLabel: '로컬',
    }));

    const { result } = await renderHook(() => useMeetingLibraryViewModel());

    await waitFor(() => expect(listMeetings).toHaveBeenCalledTimes(1));

    let createRequest: Promise<void> | undefined;

    await act(() => {
      createRequest = result.current.create();
    });

    expect(createMeeting).toHaveBeenCalledWith('');
    expect(listMeetings).toHaveBeenCalledTimes(1);

    if (!resolveCreate || !createRequest) {
      throw new Error('회의 생성 요청이 시작되지 않았습니다.');
    }

    await act(async () => {
      resolveCreate?.(meeting);
      await createRequest;
    });

    expect(listMeetings).toHaveBeenCalledTimes(2);
    expect(mockedToMeetingListItemVM).toHaveBeenCalledWith(meeting, 'Asia/Seoul');
    expect(result.current.items).toEqual([
      expect.objectContaining({ id: 'meeting-1', title: '제품 회의' }),
    ]);
  });
});
