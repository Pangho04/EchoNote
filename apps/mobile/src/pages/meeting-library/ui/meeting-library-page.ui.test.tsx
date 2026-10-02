import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { type Meeting, MeetingStatus } from '@/entities/meeting';
import { useSession } from '@/features/authenticate';
import { deleteMeetings } from '@/features/delete-meeting';
import { makeListMeetings } from '@/features/list-meetings';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { MeetingLibraryPage } from './meeting-library-page';

const mockedPush = jest.fn();
const mockedSignOut = jest.fn();

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));
jest.mock('@/features/authenticate', () => ({
  useSession: jest.fn(),
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
const mockedUseSession = jest.mocked(useSession);
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
    mockedUseSession.mockReturnValue({
      state: { kind: 'signedIn' },
      signIn: jest.fn(),
      signOut: mockedSignOut,
    } as unknown as ReturnType<typeof useSession>);
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' })),
    );
  });

  it('목록이 비어도 로그아웃 버튼을 보여준다', async () => {
    const { getByLabelText } = await renderPage();

    expect(getByLabelText(UI_STRINGS.auth.signOut)).toBeTruthy();
  });

  it('로그아웃 버튼을 누르면 확인 팝업을 띄우고 [로그아웃]만 signOut을 호출한다', async () => {
    const { getByLabelText, getByText, getAllByText } = await renderPage();

    await fireEvent.press(getByLabelText(UI_STRINGS.auth.signOut));

    expect(getByText(UI_STRINGS.auth.signOutTitle)).toBeTruthy();

    await fireEvent.press(getByText(UI_STRINGS.common.cancel));

    expect(mockedSignOut).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText(UI_STRINGS.auth.signOut));
    // 트리거 버튼과 팝업 action 버튼이 같은 문구라서 팝업 쪽인 마지막 요소를 누른다.
    await fireEvent.press(getAllByText(UI_STRINGS.auth.signOut).at(-1)!);

    expect(mockedSignOut).toHaveBeenCalledTimes(1);
  });

  it('삭제 중에는 로그아웃 버튼을 비활성한다', async () => {
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({
        meetings: [meeting('m1', '제품 회의')],
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      })),
    );
    mockedDeleteMeetings.mockReturnValue(new Promise(() => {}));

    const { getByLabelText, getByText } = await renderPage();

    await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

    await fireEvent.press(getByLabelText('선택 시작'));
    await fireEvent.press(getByText('제품 회의'));
    await fireEvent.press(getByLabelText('선택한 회의 삭제'));
    await fireEvent.press(getByText(UI_STRINGS.common.confirm));

    await waitFor(() => expect(getByLabelText(UI_STRINGS.auth.signOut)).toBeDisabled());
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

      await fireEvent.press(getByLabelText('선택 시작'));

      expect(queryByLabelText('새 회의 녹음')).toBeNull();
      expect(getByLabelText('선택한 회의 삭제')).toBeDisabled();

      await fireEvent.press(getByText('제품 회의'));

      expect(mockedPush).not.toHaveBeenCalled();
      expect(getByText('삭제 (1)')).toBeTruthy();

      await fireEvent.press(getByLabelText('선택한 회의 삭제'));

      expect(getByText('삭제하시겠습니까? 복구가 불가능합니다.')).toBeTruthy();

      await fireEvent.press(getByText('확인'));

      await waitFor(() => expect(getByLabelText('선택 시작')).toBeTruthy());

      expect(mockedDeleteMeetings).toHaveBeenCalledWith(expect.anything(), ['m1']);
      expect(listMeetings).toHaveBeenCalledTimes(2);
      expect(getByLabelText('새 회의 녹음')).toBeTruthy();
    });

    it('확인 팝업에서 취소하면 지우지 않고 편집을 유지한다', async () => {
      setupMeetings([meeting('m1', '제품 회의')]);

      const { getByLabelText, getByText, getAllByText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText('선택 시작'));
      await fireEvent.press(getByText('제품 회의'));
      await fireEvent.press(getByLabelText('선택한 회의 삭제'));
      // 「최근 기록」 줄의 선택 끝내기 버튼도 `취소`라서 팝업 버튼은 마지막 것이다.
      await fireEvent.press(getAllByText('취소').at(-1)!);

      expect(mockedDeleteMeetings).not.toHaveBeenCalled();
      expect(getByText('삭제 (1)')).toBeTruthy();
    });

    it('삭제가 실패하면 안내하고 편집 상태를 유지한다', async () => {
      setupMeetings([meeting('m1', '제품 회의')]);
      mockedDeleteMeetings.mockRejectedValue(new Error('disk'));

      const { getByLabelText, getByText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText('선택 시작'));
      await fireEvent.press(getByText('제품 회의'));
      await fireEvent.press(getByLabelText('선택한 회의 삭제'));
      await fireEvent.press(getByText('확인'));

      await waitFor(() => expect(getByText('회의를 삭제하지 못했습니다.')).toBeTruthy());

      expect(getByLabelText('선택 끝내기')).toBeTruthy();
    });

    it('목록이 비었으면 선택 버튼을 보이지 않는다', async () => {
      const listMeetings = setupMeetings([]);

      const { queryByLabelText } = await renderPage();

      await waitFor(() => expect(listMeetings).toHaveBeenCalled());

      expect(queryByLabelText('선택 시작')).toBeNull();
    });
  });

  it('목록 끝에 닿으면 다음 page를 한 번만 불러와 뒤에 붙인다', async () => {
    const cursor = { createdAtMs: 1, meetingId: 'm2' };
    let resolveNextPage: (
      value: Awaited<ReturnType<ReturnType<typeof makeListMeetings>>>,
    ) => void = () => undefined;
    const listMeetings = jest
      .fn()
      .mockResolvedValueOnce({
        meetings: [meeting('m1', '제품 회의')],
        nextCursor: cursor,
        timeZone: 'Asia/Seoul',
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNextPage = resolve;
        }),
      );

    mockedMakeListMeetings.mockReturnValue(listMeetings);

    const { getByTestId, getByText } = await renderPage();

    await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

    await fireEvent(getByTestId('meeting-list'), 'endReached');
    await fireEvent(getByTestId('meeting-list'), 'endReached');

    expect(listMeetings).toHaveBeenCalledTimes(2);
    expect(listMeetings).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));

    resolveNextPage({
      meetings: [meeting('m2', '주간 회의')],
      nextCursor: null,
      timeZone: 'Asia/Seoul',
    });

    await waitFor(() => expect(getByText('주간 회의')).toBeTruthy());

    expect(getByText('제품 회의')).toBeTruthy();

    await fireEvent(getByTestId('meeting-list'), 'endReached');

    expect(listMeetings).toHaveBeenCalledTimes(2);
  });

  describe('연도 필터', () => {
    const currentYear = new Date().getFullYear();

    function setupList() {
      const listMeetings = jest.fn(async () => ({
        meetings: [meeting('m1', '제품 회의')],
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      }));

      mockedMakeListMeetings.mockReturnValue(listMeetings);

      return listMeetings;
    }

    it('연도를 고르면 메뉴를 닫고 그 연도의 첫 page부터 다시 읽는다', async () => {
      const listMeetings = setupList();

      const { getByLabelText, getByText, queryAllByRole } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText(`조회 연도 변경, 현재 ${currentYear}년`));
      await fireEvent.press(getByText(`${currentYear - 1}년`));

      await waitFor(() =>
        expect(listMeetings).toHaveBeenLastCalledWith({ year: currentYear - 1, limit: 20 }),
      );

      expect(queryAllByRole('menuitem')).toHaveLength(0);
      expect(getByLabelText(`조회 연도 변경, 현재 ${currentYear - 1}년`)).toBeTruthy();
    });

    it('메뉴는 최신 연도부터 1970년까지 나열한다', async () => {
      setupList();

      const { getByLabelText, getAllByRole } = await renderPage();

      await fireEvent.press(getByLabelText(`조회 연도 변경, 현재 ${currentYear}년`));

      const options = getAllByRole('menuitem');

      expect(options).toHaveLength(currentYear - 1970 + 1);
      expect(options[0]).toHaveTextContent(`${currentYear}년`);
      expect(options.at(-1)).toHaveTextContent('1970년');
    });

    it('편집을 시작하면 연도 필터를 비활성한다', async () => {
      setupList();

      const { getByLabelText, getByText, queryAllByRole } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText(`조회 연도 변경, 현재 ${currentYear}년`));
      await fireEvent.press(getByLabelText('선택 시작'));

      expect(queryAllByRole('menuitem')).toHaveLength(0);
      expect(getByLabelText(`조회 연도 변경, 현재 ${currentYear}년`)).toBeDisabled();
    });

    it('회의가 없는 연도를 고르면 조회가 끝난 뒤 빈 목록 문구를 보인다', async () => {
      let resolveEmpty: (
        value: Awaited<ReturnType<ReturnType<typeof makeListMeetings>>>,
      ) => void = () => {};
      const listMeetings = jest.fn(({ year }: { year: number }) =>
        year === currentYear
          ? Promise.resolve({
              meetings: [meeting('m1', '제품 회의')],
              nextCursor: null,
              timeZone: 'Asia/Seoul',
            })
          : new Promise((resolve) => {
              resolveEmpty = resolve;
            }),
      );

      mockedMakeListMeetings.mockReturnValue(
        listMeetings as unknown as ReturnType<typeof makeListMeetings>,
      );

      const { getByLabelText, getByText, queryByText } = await renderPage();

      await waitFor(() => expect(getByText('제품 회의')).toBeTruthy());

      await fireEvent.press(getByLabelText(`조회 연도 변경, 현재 ${currentYear}년`));
      await fireEvent.press(getByText(`${currentYear - 1}년`));

      expect(queryByText('저장된 회의가 없습니다.')).toBeNull();

      resolveEmpty({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' });

      await waitFor(() => expect(getByText('저장된 회의가 없습니다.')).toBeTruthy());
    });
  });
});
