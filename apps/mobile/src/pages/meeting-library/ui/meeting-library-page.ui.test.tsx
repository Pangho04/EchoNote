import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { type Meeting, MeetingStatus } from '@/entities/meeting';
import { deleteMeetings } from '@/features/delete-meeting';
import { makeListMeetings } from '@/features/list-meetings';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { MeetingLibraryPage } from './meeting-library-page';

const mockedPush = jest.fn();

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));
jest.mock('@/features/list-meetings', () => ({
  makeListMeetings: jest.fn(),
}));
jest.mock('@/features/record-meeting', () => ({
  startRecording: jest.fn(),
  recordingPermissionService: { get: jest.fn(), request: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('@/features/delete-meeting', () => ({
  deleteMeetings: jest.fn(),
}));
jest.mock('@/entities/recording', () => ({
  createSQLiteRecordingPersistence: () => ({ deleteMeetingsWithRecordings: jest.fn() }),
  deleteRecordingFile: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'mocked-uuid' }));
jest.mock('@/features/record-meeting/api/recording-permission-service.native', () => ({
  recordingPermissionService: { get: jest.fn(), request: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react') as typeof React;

  return {
    useRouter: () => ({ push: mockedPush, back: jest.fn() }),
    // 화면 포커스를 mount 시 1회 실행으로 대신한다.
    useFocusEffect: (callback: () => void) => {
      useEffect(callback, [callback]);
    },
  };
});

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);
const mockedDeleteMeetings = jest.mocked(deleteMeetings);

function renderPage() {
  return render(
    <GestureHandlerRootView>
      <ThemeProvider mode="light">
        <DialogProvider>
          <MeetingLibraryPage />
        </DialogProvider>
      </ThemeProvider>
    </GestureHandlerRootView>,
  );
}

function meeting(id: string, title: string): Meeting {
  return {
    id,
    title,
    status: MeetingStatus.LocalOnly,
    createdAt: '2026-08-04T01:00:00.000Z',
    updatedAt: '2026-08-04T01:00:00.000Z',
    durationMs: null,
  };
}

describe('MeetingLibraryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSQLiteContext.mockReturnValue({} as ReturnType<typeof useSQLiteContext>);
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' })),
    );
  });

  it('녹음 버튼을 누르면 제목 모달을 연다', async () => {
    const { getByLabelText, queryByText } = await renderPage();

    expect(queryByText('녹음 시작')).toBeNull();

    await fireEvent.press(getByLabelText('새 회의 녹음'));

    expect(queryByText('녹음 시작')).toBeTruthy();
  });

  it('granted면 녹음 route로 이동한다', async () => {
    const { startRecording } = jest.requireMock('@/features/record-meeting') as {
      startRecording: jest.Mock;
    };
    startRecording.mockResolvedValue({ kind: 'granted', meetingId: 'm1' });

    const { getByLabelText, getByPlaceholderText, getByText } = await renderPage();

    await fireEvent.press(getByLabelText('새 회의 녹음'));
    await fireEvent.changeText(getByPlaceholderText('기본 이름으로 저장'), '제목');
    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() => expect(mockedPush).toHaveBeenCalledWith('/recording?meetingId=m1'));
  });

  it('목록 항목을 누르면 상세 route로 이동한다', async () => {
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({
        meetings: [
          {
            id: 'm1',
            title: '제품 회의',
            status: MeetingStatus.LocalOnly,
            createdAt: '2026-08-04T01:00:00.000Z',
            updatedAt: '2026-08-04T01:00:00.000Z',
            durationMs: null,
          },
        ],
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      })),
    );

    const { getByText } = await renderPage();

    await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

    await fireEvent.press(getByText('제품 회의'));

    expect(mockedPush).toHaveBeenCalledWith('/meetings/m1');
    expect(mockedPush).toHaveBeenCalledTimes(1);
  });

  it('설정 열기를 누르면 모달을 닫아 권한을 다시 확인할 수 있게 한다', async () => {
    const { startRecording } = jest.requireMock('@/features/record-meeting') as {
      startRecording: jest.Mock;
    };
    const { recordingPermissionService } = jest.requireMock(
      '@/features/record-meeting/api/recording-permission-service.native',
    ) as { recordingPermissionService: { openSettings: jest.Mock } };
    startRecording.mockResolvedValue({ kind: 'blocked' });

    const { getByLabelText, getByText, queryByText } = await renderPage();

    await fireEvent.press(getByLabelText('새 회의 녹음'));
    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() => expect(getByText('설정 열기')).toBeTruthy());

    await fireEvent.press(getByText('설정 열기'));

    expect(recordingPermissionService.openSettings).toHaveBeenCalledTimes(1);
    expect(queryByText('설정 열기')).toBeNull();
  });

  describe('편집 모드', () => {
    function setupMeetings(meetings: Meeting[]) {
      const listMeetings = jest.fn(async () => ({
        meetings,
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      }));

      mockedMakeListMeetings.mockReturnValue(listMeetings);

      return listMeetings;
    }

    it('고른 회의만 확인 뒤 지우고 편집을 끝낸 채 목록을 다시 읽는다', async () => {
      const listMeetings = setupMeetings([meeting('m1', '제품 회의'), meeting('m2', '주간 회의')]);
      mockedDeleteMeetings.mockResolvedValue();

      const { getByLabelText, getByText, queryByLabelText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText('편집 시작'));

      expect(queryByLabelText('새 회의 녹음')).toBeNull();
      expect(getByLabelText('선택한 회의 삭제')).toBeDisabled();

      await fireEvent.press(getByText('제품 회의'));

      expect(mockedPush).not.toHaveBeenCalled();
      expect(getByText('삭제 (1)')).toBeTruthy();

      await fireEvent.press(getByLabelText('선택한 회의 삭제'));

      expect(getByText('삭제하시겠습니까? 복구가 불가능합니다.')).toBeTruthy();

      await fireEvent.press(getByText('확인'));

      await waitFor(() => expect(getByLabelText('편집 시작')).toBeTruthy());

      expect(mockedDeleteMeetings).toHaveBeenCalledWith(expect.anything(), ['m1']);
      expect(listMeetings).toHaveBeenCalledTimes(2);
      expect(getByLabelText('새 회의 녹음')).toBeTruthy();
    });

    it('확인 팝업에서 취소하면 지우지 않고 선택을 유지한다', async () => {
      setupMeetings([meeting('m1', '제품 회의')]);

      const { getByLabelText, getByText, getAllByText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText('편집 시작'));
      await fireEvent.press(getByText('제품 회의'));
      await fireEvent.press(getByLabelText('선택한 회의 삭제'));
      // 헤더의 편집 끝내기 버튼도 `취소`라서 팝업 버튼은 마지막 것이다.
      await fireEvent.press(getAllByText('취소').at(-1)!);

      expect(mockedDeleteMeetings).not.toHaveBeenCalled();
      expect(getByText('삭제 (1)')).toBeTruthy();
    });

    it('삭제가 실패하면 안내하고 편집 상태를 유지한다', async () => {
      setupMeetings([meeting('m1', '제품 회의')]);
      mockedDeleteMeetings.mockRejectedValue(new Error('disk'));

      const { getByLabelText, getByText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText('편집 시작'));
      await fireEvent.press(getByText('제품 회의'));
      await fireEvent.press(getByLabelText('선택한 회의 삭제'));
      await fireEvent.press(getByText('확인'));

      await waitFor(() => expect(getByText('회의를 삭제하지 못했습니다.')).toBeTruthy());

      expect(getByLabelText('편집 끝내기')).toBeTruthy();
    });

    it('목록이 비었으면 편집 버튼을 보이지 않는다', async () => {
      const listMeetings = setupMeetings([]);

      const { queryByLabelText } = await renderPage();

      await waitFor(() => expect(listMeetings).toHaveBeenCalled());

      expect(queryByLabelText('편집 시작')).toBeNull();
    });
  });
});
