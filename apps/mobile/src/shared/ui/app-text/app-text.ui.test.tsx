import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { darkTheme, lightTheme, type ThemeMode, typography } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { AppText } from './AppText';

describe('AppText', () => {
  it('display variant의 typography token을 적용하고 시스템 글꼴을 유지한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <AppText variant="display">회의</AppText>
      </ThemeProvider>,
    );

    const text = screen.getByText('회의');
    const flattenedStyle = StyleSheet.flatten(text.props.style);

    expect(text).toHaveStyle({
      fontSize: typography.fontSize.largeTitle,
      fontWeight: typography.fontWeight.bold,
      lineHeight: typography.lineHeight.largeTitle,
    });
    expect(flattenedStyle).not.toHaveProperty('fontFamily');
  });

  it.each([
    { color: lightTheme.colors.textPrimary, mode: 'light' },
    { color: darkTheme.colors.textPrimary, mode: 'dark' },
  ] satisfies ReadonlyArray<{ color: string; mode: ThemeMode }>)(
    '$mode 모드의 의미 색상 토큰을 적용한다',
    async ({ color, mode }) => {
      await render(
        <ThemeProvider mode={mode}>
          <AppText color="textPrimary" variant="body">
            본문
          </AppText>
        </ThemeProvider>,
      );

      expect(screen.getByText('본문')).toHaveStyle({ color });
    },
  );
});
