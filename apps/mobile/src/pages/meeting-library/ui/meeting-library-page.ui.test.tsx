import { render, screen } from '@testing-library/react-native';

import { darkTheme, lightTheme, type ThemeMode } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { MeetingLibraryPage } from './meeting-library-page';

describe('MeetingLibraryPage', () => {
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
});
