import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { createMeetingDetailLoader } from '../model/create-meeting-detail-loader';
import type { MeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
import { useMeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
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
jest.mock('../model/create-meeting-detail-loader', () => ({
  createMeetingDetailLoader: jest.fn(),
}));
jest.mock('../model/use-meeting-detail-view-model', () => ({
  useMeetingDetailViewModel: jest.fn(),
}));

const mockedUseSQLiteContext = jest.mocked(useSQLiteContext);
const mockedUseRouter = jest.mocked(useRouter);
const mockedCreateMeetingDetailLoader = jest.mocked(createMeetingDetailLoader);
const mockedUseMeetingDetailViewModel = jest.mocked(useMeetingDetailViewModel);
const mockedLoad = jest.fn();
const database = {} as ReturnType<typeof useSQLiteContext>;

async function renderPage() {
  return render(
    <ThemeProvider mode="light">
      <DialogProvider>
        <MeetingDetailPage meetingId="m1" />
      </DialogProvider>
    </ThemeProvider>,
  );
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
    // 뒤로 갈 화면이 없는 deep link 진입을 기본값으로 둔다. back 경로는 개별 케이스가 켠다.
    mockedCanGoBack.mockReturnValue(false);
  });

  it('같은 database로 다시 렌더하면 loader를 새로 만들지 않고 meetingId·timeZone과 함께 넘겨 ready를 렌더한다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      dateLabel: '2026년 9월 9일 · 오후 3:00',
      kind: 'ready',
      metaLabel: '12분 · 녹음만 저장됨',
      title: '주간 회의',
    });

    const { getByText, rerender } = await renderPage();

    // 다시 렌더해도 loader는 database가 그대로면 새로 만들지 않는다.
    await rerender(
      <ThemeProvider mode="light">
        <DialogProvider>
          <MeetingDetailPage meetingId="m1" />
        </DialogProvider>
      </ThemeProvider>,
    );

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
  });

  it.each([
    ['not-found', '회의를 찾을 수 없습니다.'],
    ['error', '회의를 불러오지 못했습니다.'],
  ] as const)('%s 상태면 본문 없이 팝업으로만 안내한다', async (kind, message) => {
    mockedUseMeetingDetailViewModel.mockReturnValue({ kind, message } as MeetingDetailViewModel);

    const { getByText } = await renderPage();

    // 본문이 아니라 팝업이 문구를 소유한다.
    expect(getByText('회의를 열 수 없습니다')).toBeTruthy();
    expect(getByText(message)).toBeTruthy();

    await fireEvent.press(getByText('확인'));

    expect(mockedReplace).toHaveBeenCalledWith('/');
  });

  it('canGoBack이 true면 back을, false면 replace를 호출한다', async () => {
    mockedUseMeetingDetailViewModel.mockReturnValue({
      dateLabel: '2026년 9월 9일 · 오후 3:00',
      kind: 'ready',
      metaLabel: '12분 · 녹음만 저장됨',
      title: '주간 회의',
    });

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
});
