import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import type { Recording } from '@/entities/recording';
import { RecordingPlayer, useRecordingPlayback } from '@/features/play-recording';
import { pendingImports } from '@/features/record-meeting';
import {
  createTranscriptionDeps,
  TranscriptionPanel,
  useTranscription,
} from '@/features/request-transcription';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import {
  createMeetingDetailLoader,
  createMeetingTitleCommands,
} from '../model/create-meeting-detail-loader';
import {
  type MeetingDetailViewModel,
  useMeetingDetailViewModel,
} from '../model/use-meeting-detail-view-model';
import { MeetingDetailPage } from './meeting-detail-page';

const mockedBack = jest.fn();
const mockedReplace = jest.fn();
const mockedCanGoBack = jest.fn();

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));
// native player·Gateway 요청을 품고 있어 page test에서는 placeholder로 바꾼다.
jest.mock('@/features/play-recording', () => ({
  RecordingPlayer: jest.fn(() => null),
  useRecordingPlayback: jest.fn(),
}));
jest.mock('@/features/request-transcription', () => ({
  createTranscriptionDeps: jest.fn(),
  TranscriptionPanel: jest.fn(() => null),
  useTranscription: jest.fn(),
}));
jest.mock('@/shared/api/gateway-client', () => ({
  useGatewayClient: jest.fn(() => gateway),
}));
jest.mock('../model/create-meeting-detail-loader', () => ({
  createMeetingDetailLoader: jest.fn(),
  createMeetingTitleCommands: jest.fn(),
}));
jest.mock('../model/use-meeting-detail-view-model', () => ({
  useMeetingDetailViewModel: jest.fn(),
}));
// pendingImports는 싱글턴 객체라 느슨하게 mock해 page가 전달하는 메서드만 대체한다.
jest.mock('@/features/record-meeting', () => ({
  pendingImports: { consume: jest.fn(), get: jest.fn(() => undefined) },
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedUseRouter = jest.mocked(useRouter);
const mockedCreateMeetingDetailLoader = jest.mocked(createMeetingDetailLoader);
const mockedCreateMeetingTitleCommands = jest.mocked(createMeetingTitleCommands);
const mockedUseMeetingDetailViewModel = jest.mocked(useMeetingDetailViewModel);
const mockedLoad = jest.fn();
const mockedLoadMeeting = jest.fn();
const mockedRenameMeetingCommand = jest.fn();
const database = {} as ReturnType<typeof useSQLiteContext>;
const gateway = {};
const transcriptionDeps = {} as ReturnType<typeof createTranscriptionDeps>;
const mockedPlayFrom = jest.fn(async () => {});
const player = { playFrom: mockedPlayFrom, positionMs: 12_000 } as unknown as ReturnType<
  typeof useRecordingPlayback
>;
const transcription = { panel: { kind: 'none', notice: null } } as ReturnType<
  typeof useTranscription
>;

const recording: Recording = {
  meetingId: 'm1',
  uri: 'file://recording.m4a',
  mimeType: 'audio/mp4',
  sha256: 'sha256',
  durationMs: 720_000,
  byteSize: 1_000,
};

const mockedRename = jest.fn(async () => {});

const readyState = {
  viewModel: {
    kind: 'ready',
    title: '주간 회의',
    dateLabel: '2026년 9월 9일 · 오후 3:00',
    durationLabel: '12분',
  },
  recording,
  rename: mockedRename,
} as const;

function pageElement(autoRequest = false) {
  return (
    <ThemeProvider mode="light">
      <DialogProvider>
        <MeetingDetailPage autoRequest={autoRequest} meetingId="m1" />
      </DialogProvider>
    </ThemeProvider>
  );
}

async function renderPage(autoRequest = false) {
  return render(pageElement(autoRequest));
}

describe('MeetingDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSQLiteContext.mockReturnValue(database);
    mockedUseRouter.mockReturnValue({
      back: mockedBack,
      canGoBack: mockedCanGoBack,
      push: jest.fn(),
      replace: mockedReplace,
    } as unknown as ReturnType<typeof useRouter>);
    mockedCreateMeetingDetailLoader.mockReturnValue(mockedLoad);
    mockedCreateMeetingTitleCommands.mockReturnValue({
      loadMeeting: mockedLoadMeeting,
      renameMeeting: mockedRenameMeetingCommand,
    });
    jest.mocked(pendingImports.get).mockReturnValue(undefined);
    // 뒤로 갈 화면이 없는 deep link 진입을 기본값으로 둔다. back 경로는 개별 케이스가 켠다.
    mockedCanGoBack.mockReturnValue(false);
    jest.mocked(createTranscriptionDeps).mockReturnValue(transcriptionDeps);
    jest.mocked(useRecordingPlayback).mockReturnValue(player);
    jest.mocked(useTranscription).mockReturnValue(transcription);
  });

  it('같은 database로 다시 렌더하면 loader를 새로 만들지 않고 meetingId·timeZone과 함께 넘겨 ready를 렌더한다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue(readyState);

    const { getByText, rerender } = await renderPage();

    // 다시 렌더해도 loader는 database가 그대로면 새로 만들지 않는다.
    await rerender(pageElement());

    expect(mockedCreateMeetingDetailLoader).toHaveBeenCalledWith(database);
    expect(mockedCreateMeetingDetailLoader).toHaveBeenCalledTimes(1);
    expect(mockedUseMeetingDetailViewModel).toHaveBeenCalledWith(
      expect.objectContaining({
        loadMeetingDetail: mockedLoad,
        meetingId: 'm1',
        timeZone: expect.any(String),
      }),
    );
    expect(getByText('주간 회의')).toBeTruthy();
    expect(getByText('2026년 9월 9일 · 오후 3:00')).toBeTruthy();
    expect(getByText('12분 · 녹음만 저장됨')).toBeTruthy();
    expect(RecordingPlayer).toHaveBeenCalledWith({ viewModel: player }, undefined);
  });

  it('ready면 녹음 Domain과 autoRequest를 재생·텍스트 변환 훅에 넘기고 전사 행 탭은 그 시각부터 재생한다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue(readyState);

    await renderPage(true);

    expect(createTranscriptionDeps).toHaveBeenCalledWith(database, gateway);
    expect(useRecordingPlayback).toHaveBeenCalledWith('file://recording.m4a');
    expect(useTranscription).toHaveBeenLastCalledWith(transcriptionDeps, recording, true);

    const panelProps = jest.mocked(TranscriptionPanel).mock.lastCall?.[0];

    expect(panelProps?.viewModel).toBe(transcription);
    expect(panelProps?.positionMs).toBe(12_000);

    panelProps?.onPressSegment(3_000);

    expect(mockedPlayFrom).toHaveBeenCalledWith(3_000);
  });

  it.each([
    ['not-found', '회의를 찾을 수 없습니다.'],
    ['recording-missing', '녹음 파일을 찾을 수 없습니다.'],
    ['error', '회의를 불러오지 못했습니다.'],
  ] as const)('%s 상태면 본문 없이 팝업으로만 안내한다', async (kind, message) => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      viewModel: { kind, message } as MeetingDetailViewModel,
      recording: null,
      rename: mockedRename,
    });

    const { getByText } = await renderPage();

    // 본문이 아니라 팝업이 문구를 소유한다.
    expect(getByText('회의를 열 수 없습니다')).toBeTruthy();
    expect(getByText(message)).toBeTruthy();

    await fireEvent.press(getByText('확인'));

    expect(mockedReplace).toHaveBeenCalledWith('/');
    expect(useTranscription).not.toHaveBeenCalled();
  });

  it('canGoBack이 true면 back을, false면 replace를 호출한다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue(readyState);

    mockedCanGoBack.mockReturnValue(true);

    const { getByLabelText } = await renderPage();

    await fireEvent.press(getByLabelText('회의 목록으로 이동'));

    expect(mockedBack).toHaveBeenCalledTimes(1);
    expect(mockedReplace).not.toHaveBeenCalled();

    mockedCanGoBack.mockReturnValue(false);

    await fireEvent.press(getByLabelText('회의 목록으로 이동'));

    expect(mockedReplace).toHaveBeenCalledWith('/');
    expect(mockedReplace).toHaveBeenCalledTimes(1);
  });

  it('T-D2: importing이면 업로드 중 문구와 가져오기 메타·제목을 보여주고 재생기·텍스트 변환 훅을 호출하지 않는다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      viewModel: {
        kind: 'importing',
        title: '가져온 회의',
        dateLabel: '2026년 10월 3일 · 오전 9:00',
      },
      recording: null,
      rename: mockedRename,
    });

    const { getByText } = await renderPage();

    expect(getByText('가져온 회의')).toBeTruthy();
    expect(getByText('업로드 중')).toBeTruthy();
    expect(getByText('녹음 파일 가져오는 중')).toBeTruthy();
    expect(useRecordingPlayback).not.toHaveBeenCalled();
    expect(useTranscription).not.toHaveBeenCalled();
  });

  it('T-D5: importing이면 제목 수정 연필이 disabled고, ready면 enabled다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      viewModel: {
        kind: 'importing',
        title: '가져온 회의',
        dateLabel: '2026년 10월 3일 · 오전 9:00',
      },
      recording: null,
      rename: mockedRename,
    });

    const importing = await renderPage();

    expect(importing.getByLabelText('회의 제목 수정').props.accessibilityState.disabled).toBe(true);

    mockedUseMeetingDetailViewModel.mockReturnValue(readyState);

    const ready = await renderPage();

    expect(ready.getByLabelText('회의 제목 수정').props.accessibilityState.disabled).toBe(false);
  });

  it('T-D4: import-failed면 팝업 없이 목록으로 한 번만 돌아간다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      viewModel: { kind: 'import-failed' },
      recording: null,
      rename: mockedRename,
    });

    const { queryByText, rerender } = await renderPage();

    expect(queryByText('회의를 열 수 없습니다')).toBeNull();
    expect(mockedReplace).toHaveBeenCalledWith('/');
    expect(mockedReplace).toHaveBeenCalledTimes(1);

    await rerender(pageElement());

    expect(mockedReplace).toHaveBeenCalledTimes(1);
  });

  it('T-I7b: ready면 autoRequest를 텍스트 변환 훅에 그대로 넘긴다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue(readyState);

    await renderPage(true);

    expect(useTranscription).toHaveBeenLastCalledWith(transcriptionDeps, recording, true);
  });
});
