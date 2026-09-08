import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { makeListMeetings } from '@/features/list-meetings';
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'mocked-uuid' }));
jest.mock('@/features/record-meeting/api/recording-permission-service.native', () => ({
  recordingPermissionService: { get: jest.fn(), request: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockedPush, back: jest.fn() }),
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedMakeListMeetings = jest.mocked(makeListMeetings);

describe('MeetingLibraryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSQLiteContext.mockReturnValue({} as ReturnType<typeof useSQLiteContext>);
    mockedMakeListMeetings.mockReturnValue(
      jest.fn(async () => ({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' })),
    );
  });

  it('녹음 버튼을 누르면 제목 모달을 연다', async () => {
    const { getByLabelText, queryByText } = await render(
      <ThemeProvider mode="light">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    expect(queryByText('녹음 시작')).toBeNull();

    await fireEvent.press(getByLabelText('새 회의 녹음'));

    expect(queryByText('녹음 시작')).toBeTruthy();
  });

  it('granted면 녹음 route로 이동한다', async () => {
    const { startRecording } = jest.requireMock('@/features/record-meeting') as {
      startRecording: jest.Mock;
    };
    startRecording.mockResolvedValue({ kind: 'granted', meetingId: 'm1' });

    const { getByLabelText, getByPlaceholderText, getByText } = await render(
      <ThemeProvider mode="light">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    await fireEvent.press(getByLabelText('새 회의 녹음'));
    await fireEvent.changeText(getByPlaceholderText('기본 이름으로 저장'), '제목');
    await fireEvent.press(getByText('녹음 시작'));

    await waitFor(() => expect(mockedPush).toHaveBeenCalledWith('/recording?meetingId=m1'));
  });
});
