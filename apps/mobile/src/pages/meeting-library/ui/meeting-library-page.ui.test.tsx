import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type React from 'react';
import { BackHandler } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { type Meeting, MeetingStatus } from '@/entities/meeting';
import { useSession } from '@/features/authenticate';
import { deleteMeetings } from '@/features/delete-meeting';
import { makeListMeetings } from '@/features/list-meetings';
import { importRecording, pendingImports } from '@/features/record-meeting';
import { ROUTES } from '@/shared/config/routes';
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
jest.mock('@/features/record-meeting', () => {
  const actual = jest.requireActual('@/features/record-meeting');

  return {
    startRecording: jest.fn(),
    recordingPermissionService: { get: jest.fn(), request: jest.fn(), openSettings: jest.fn() },
    importRecording: jest.fn(),
    isAllowedRecordingMimeType: jest.fn(() => true),
    pendingImports: actual.pendingImports,
  };
});
jest.mock('@/features/record-meeting/api/recording-import-service.native', () => {
  const pickRecording = jest.fn();

  return {
    __mockedPickRecording: pickRecording,
    createNativeRecordingImportService: () => ({
      pickRecording,
      copyToCache: jest.fn(),
      readHeaderBytes: jest.fn(),
      readDurationMs: jest.fn(),
    }),
  };
});
jest.mock('@/features/record-meeting/api/recording-file-service.native', () => ({
  createNativeRecordingFileService: jest.fn(),
  createFinalRecordingUri: jest.fn(),
}));
jest.mock('@/features/delete-meeting', () => ({
  deleteMeetings: jest.fn(),
}));
jest.mock('@/entities/recording', () => ({
  createSQLiteRecordingPersistence: () => ({ deleteMeetingsWithRecordings: jest.fn() }),
  deleteRecordingFile: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'mocked-uuid' }));
// Provider처럼 렌더마다 같은 client를 준다.
const mockGatewayClient = {};

jest.mock('@/shared/api/gateway-client', () => ({
  useGatewayClient: jest.fn(() => mockGatewayClient),
}));
jest.mock('@/features/request-transcription', () => ({
  createTranscriptionDeps: jest.fn(() => ({})),
  syncPendingTranscriptions: jest.fn(async () => false),
  TRANSCRIPTION_POLL_INTERVAL_MS: 5_000,
}));
jest.mock('@/features/record-meeting/api/recording-permission-service.native', () => ({
  recordingPermissionService: { get: jest.fn(), request: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('expo-router', () => {
  const { useEffect, useRef } = jest.requireActual('react') as typeof React;

  let isRouteFocused = false;
  let nextRegistrationId = 0;
  const registrations = new Map<
    number,
    { callback: () => void | (() => void); cleanup: (() => void) | undefined }
  >();

  // 화면 포커스를 React lifecycle이 아니라 테스트가 __focusRouter·__blurRouter로 직접 몬다.
  function useFocusEffect(callback: () => void | (() => void)) {
    const idRef = useRef<number | null>(null);

    if (idRef.current === null) {
      idRef.current = nextRegistrationId++;
      registrations.set(idRef.current, { callback, cleanup: undefined });
    }

    const id = idRef.current;

    useEffect(() => {
      const registration = registrations.get(id);

      if (!registration) return;

      registration.callback = callback;

      if (isRouteFocused) {
        registration.cleanup?.();
        const result = callback();
        registration.cleanup = typeof result === 'function' ? result : undefined;
      }
    }, [callback]);
  }

  return {
    useRouter: () => ({ push: mockedPush, back: jest.fn() }),
    useFocusEffect,
    __focusRouter() {
      isRouteFocused = true;

      for (const registration of registrations.values()) {
        const result = registration.callback();

        registration.cleanup = typeof result === 'function' ? result : undefined;
      }
    },
    __blurRouter() {
      isRouteFocused = false;

      for (const registration of registrations.values()) {
        registration.cleanup?.();
        registration.cleanup = undefined;
      }
    },
    __resetRouterFocus() {
      isRouteFocused = false;
      registrations.clear();
      nextRegistrationId = 0;
    },
  };
});

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedUseSession = jest.mocked(useSession);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);
const mockedDeleteMeetings = jest.mocked(deleteMeetings);
const mockedImportRecording = jest.mocked(importRecording);
const { __focusRouter, __blurRouter, __resetRouterFocus } = jest.requireMock('expo-router') as {
  __focusRouter(): void;
  __blurRouter(): void;
  __resetRouterFocus(): void;
};
const { __mockedPickRecording: mockedPickRecording } = jest.requireMock(
  '@/features/record-meeting/api/recording-import-service.native',
) as {
  __mockedPickRecording: jest.Mock;
};

async function renderPage() {
  const utils = await render(
    <GestureHandlerRootView>
      <ThemeProvider mode="light">
        <DialogProvider>
          <MeetingLibraryPage />
        </DialogProvider>
      </ThemeProvider>
    </GestureHandlerRootView>,
  );

  __focusRouter();

  return utils;
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
    __resetRouterFocus();
    mockedUseSQLiteContext.mockReturnValue({} as ReturnType<typeof useSQLiteContext>);
    mockedUseSession.mockReturnValue({
      state: { kind: 'signedIn' },
      signIn: jest.fn(),
      signOut: mockedSignOut,
    } as unknown as ReturnType<typeof useSession>);
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' })),
    );
    // 기본은 성공으로 두고, 실패 경로를 보는 테스트만 따로 바꾼다.
    mockedImportRecording.mockResolvedValue({
      kind: 'saved',
      recording: {
        meetingId: 'mocked-uuid',
        uri: 'file:///mocked.m4a',
        mimeType: 'audio/mp4',
        sha256: 'hash',
        durationMs: 1000,
        byteSize: 100,
      },
    });
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

  it('녹음하기를 누르면 제목 모달을 연다', async () => {
    const { getByLabelText, queryByText } = await renderPage();

    expect(queryByText('녹음 시작')).toBeNull();

    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuRecord));

    expect(queryByText('녹음 시작')).toBeTruthy();
  });

  it('granted면 녹음 route로 이동한다', async () => {
    const { startRecording } = jest.requireMock('@/features/record-meeting') as {
      startRecording: jest.Mock;
    };
    startRecording.mockResolvedValue({ kind: 'granted', meetingId: 'm1' });

    const { getByLabelText, getByPlaceholderText, getByText } = await renderPage();

    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuRecord));
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

    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
    await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuRecord));
    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() => expect(getByText('설정 열기')).toBeTruthy());

    await fireEvent.press(getByText('설정 열기'));

    expect(recordingPermissionService.openSettings).toHaveBeenCalledTimes(1);
    expect(queryByText('설정 열기')).toBeNull();
  });

  describe('생성 메뉴', () => {
    it('T-F2: 메뉴가 열린 동안만 하드웨어 뒤로 가기를 가로채 메뉴를 닫는다', async () => {
      const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');

      const { getByLabelText, queryByLabelText } = await renderPage();

      expect(
        addEventListenerSpy.mock.calls.some(([eventName]) => eventName === 'hardwareBackPress'),
      ).toBe(false);

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeTruthy();

      const handler = addEventListenerSpy.mock.calls
        .filter(([eventName]) => eventName === 'hardwareBackPress')
        .at(-1)?.[1] as (() => boolean) | undefined;

      expect(handler).toBeDefined();

      let handled: boolean | undefined;

      await act(async () => {
        handled = handler!();
      });

      expect(handled).toBe(true);
      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeNull();
    });

    it('T-F4: 메뉴가 열린 상태에서 덮개를 탭하면 메뉴만 닫힌다', async () => {
      const { getByLabelText, queryByLabelText, container } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeTruthy();

      const [overlay] = container.queryAll(
        (node) => node.props.accessibilityElementsHidden === true,
      );

      expect(overlay).toBeDefined();

      await fireEvent.press(overlay!);

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeNull();
      expect(getByLabelText(UI_STRINGS.auth.signOut)).toBeTruthy();
    });

    it('T-F5: 녹음하기를 누르면 메뉴를 닫고 제목 팝업을 연다', async () => {
      const { getByLabelText, getByText, queryByLabelText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuRecord));

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeNull();
      expect(getByText(UI_STRINGS.meetingLibrary.newRecording)).toBeTruthy();
    });

    it('T-F6: 업로드를 누르면 메뉴를 닫고 pickRecording을 호출하며 가져오는 동안 FAB를 막는다', async () => {
      let resolvePick: (
        value: { uri: string; size: number; name: string } | null,
      ) => void = () => {};
      mockedPickRecording.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePick = resolve;
          }),
      );

      const { getByLabelText, queryByLabelText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeNull();
      expect(mockedPickRecording).toHaveBeenCalledTimes(1);
      expect(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen)).toBeDisabled();

      await act(async () => {
        resolvePick(null);
      });
    });

    it('T-F7: 가져오는 동안 메뉴 열기를 다시 누를 수 없다', async () => {
      let resolvePick: (
        value: { uri: string; size: number; name: string } | null,
      ) => void = () => {};
      mockedPickRecording.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePick = resolve;
          }),
      );

      const { getByLabelText, queryByLabelText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.menuRecord)).toBeNull();

      await act(async () => {
        resolvePick(null);
      });
    });

    it('T-F8: pickRecording이 reject되면 실패를 알리고 FAB를 다시 쓸 수 있게 한다', async () => {
      mockedPickRecording.mockRejectedValue(new Error('picker crashed'));

      const { getByLabelText, getByText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));

      await waitFor(() =>
        expect(getByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeTruthy(),
      );
      expect(getByText(UI_STRINGS.meetingLibrary.uploadFailed)).toBeTruthy();

      await waitFor(() =>
        expect(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen)).not.toBeDisabled(),
      );
    });

    it('T-I1: 선택을 취소하면 알림도 이동도 없다', async () => {
      mockedPickRecording.mockResolvedValue(null);

      const { getByLabelText, queryByText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));

      await waitFor(() =>
        expect(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen)).not.toBeDisabled(),
      );

      expect(mockedPush).not.toHaveBeenCalled();
      expect(queryByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeNull();
    });

    it('T-I2: 512MB를 넘는 파일을 고르면 크기 초과를 알린다', async () => {
      mockedPickRecording.mockResolvedValue({
        uri: 'file:///big.m4a',
        size: 512 * 1024 * 1024 + 1,
        name: 'big.m4a',
      });

      const { getByLabelText, getByText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));

      await waitFor(() =>
        expect(getByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeTruthy(),
      );
      expect(getByText(UI_STRINGS.meetingLibrary.uploadTooLarge)).toBeTruthy();
      expect(mockedPush).not.toHaveBeenCalled();
    });

    it('T-I7a: 크기가 괜찮으면 가져오기를 시작하고 상세로 이동한다', async () => {
      mockedPickRecording.mockResolvedValue({ uri: 'file:///a.m4a', size: 100, name: 'a.m4a' });

      const { getByLabelText } = await renderPage();

      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen));
      await fireEvent.press(getByLabelText(UI_STRINGS.meetingLibrary.menuUpload));

      await waitFor(() =>
        expect(mockedPush).toHaveBeenCalledWith(ROUTES.meeting.afterRecording('mocked-uuid')),
      );

      pendingImports.consume('mocked-uuid');
    });

    it('T-I9: 포커스 중인 가져오기 실패를 차례로 알리고 확인할 때마다 치운다', async () => {
      const { getByText, queryByText } = await renderPage();

      await act(async () => {
        pendingImports.start('fail-1', {
          title: '회의A',
          createdAt: '2026-10-03T00:00:00.000Z',
          importRecording: async () => ({ kind: 'tooLarge' }),
        });
        pendingImports.start('fail-2', {
          title: '회의B',
          createdAt: '2026-10-03T00:00:00.000Z',
          importRecording: async () => ({ kind: 'unsupported' }),
        });
      });

      await waitFor(() =>
        expect(getByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeTruthy(),
      );
      expect(getByText(`회의A\n${UI_STRINGS.meetingLibrary.uploadTooLarge}`)).toBeTruthy();

      await fireEvent.press(getByText(UI_STRINGS.common.confirm));

      await waitFor(() =>
        expect(getByText(`회의B\n${UI_STRINGS.meetingLibrary.uploadUnsupported}`)).toBeTruthy(),
      );

      await fireEvent.press(getByText(UI_STRINGS.common.confirm));

      await waitFor(() =>
        expect(queryByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeNull(),
      );
      expect(pendingImports.failures()).toHaveLength(0);
    });

    it('T-I9: 확인 대신 바깥 탭·뒤로 가기로 닫아도 실패를 치운다', async () => {
      const { container, getByText, queryByText } = await renderPage();

      await act(async () => {
        pendingImports.start('fail-dismiss', {
          title: '회의C',
          createdAt: '2026-10-03T00:00:00.000Z',
          importRecording: async () => ({ kind: 'tooLarge' }),
        });
      });

      await waitFor(() =>
        expect(getByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeTruthy(),
      );

      await act(async () => {
        // 팝업 Modal의 onRequestClose가 바깥 탭·Android 뒤로 가기와 같은 dismiss 경로다.
        const [modal] = container.queryAll(
          (node) => typeof node.props.onRequestClose === 'function',
        );

        modal?.props.onRequestClose();
      });

      await waitFor(() =>
        expect(queryByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeNull(),
      );
      expect(pendingImports.failures()).toHaveLength(0);
    });

    it('T-I10: 포커스를 잃은 동안은 실패를 알리지 않고 복귀하면 알린다', async () => {
      const listMeetings = jest.fn(async () => ({
        meetings: [],
        nextCursor: null,
        timeZone: 'Asia/Seoul',
      }));

      mockedMakeListMeetings.mockReturnValue(listMeetings);

      const { getByText, queryByText } = await renderPage();

      await waitFor(() => expect(listMeetings).toHaveBeenCalledTimes(1));

      await act(async () => {
        __blurRouter();
      });

      await act(async () => {
        pendingImports.start('fail-3', {
          title: '회의C',
          createdAt: '2026-10-03T00:00:00.000Z',
          importRecording: async () => ({ kind: 'failed' }),
        });
        // 등록한 가져오기가 settle될 시간을 준다.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(queryByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeNull();
      expect(listMeetings).toHaveBeenCalledTimes(1);

      await act(async () => {
        __focusRouter();
      });

      await waitFor(() =>
        expect(getByText(UI_STRINGS.meetingLibrary.uploadFailedTitle)).toBeTruthy(),
      );

      pendingImports.consume('fail-3');
    });
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

      expect(queryByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen)).toBeNull();
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
      expect(getByLabelText(UI_STRINGS.meetingLibrary.createMenuOpen)).toBeTruthy();
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
