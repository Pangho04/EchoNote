import { fireEvent, render, screen } from '@testing-library/react-native';

import { darkTheme, lightTheme, type ThemeMode } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';
import { MeetingLibraryPage } from './meeting-library-page';

jest.mock('../model/use-meeting-library-view-model', () => ({
  useMeetingLibraryViewModel: jest.fn(),
}));

const mockedUseMeetingLibraryViewModel = jest.mocked(useMeetingLibraryViewModel);

describe('MeetingLibraryPage', () => {
  const create = jest.fn(async () => undefined);

  beforeEach(() => {
    create.mockClear();
    mockedUseMeetingLibraryViewModel.mockReturnValue({
      create,
      errorMessage: null,
      items: [],
    });
  });

  it('회의 목록 제목을 접근 가능한 헤더로 표시한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    expect(screen.getByRole('header', { name: '회의' })).toBeOnTheScreen();
  });

  it.each([
    { color: lightTheme.colors.textPrimary, mode: 'light' },
    { color: darkTheme.colors.textPrimary, mode: 'dark' },
  ] satisfies ReadonlyArray<{ color: string; mode: ThemeMode }>)(
    '$mode 모드의 제목 색상 토큰을 적용한다',
    async ({ color, mode }) => {
      await render(
        <ThemeProvider mode={mode}>
          <MeetingLibraryPage />
        </ThemeProvider>,
      );

      expect(screen.getByRole('header', { name: '회의' })).toHaveStyle({ color });
    },
  );

  it('다크 모드에서 제목을 읽을 수 있는 surface 색상을 헤더 배경에 적용한다', async () => {
    await render(
      <ThemeProvider mode="dark">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    expect(screen.getByRole('header', { name: '회의' }).parent).toHaveStyle({
      backgroundColor: darkTheme.colors.surface,
    });
  });

  it('녹음 시작 버튼의 우측 하단 위치를 page에서 결정한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: '새 회의 녹음' }).parent).toHaveStyle({
      bottom: 24,
      position: 'absolute',
      right: 18,
    });
  });

  it('녹음 시작 버튼을 누르면 ViewModel의 생성 command를 호출한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <MeetingLibraryPage />
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: '새 회의 녹음' }));

    expect(create).toHaveBeenCalledTimes(1);
  });
});
