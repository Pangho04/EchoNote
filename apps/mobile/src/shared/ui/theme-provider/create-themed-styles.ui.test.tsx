import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { darkTheme, lightTheme, type ThemeMode } from '@/shared/config/theme';

import { createThemedStyles, ThemeProvider } from './index';

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    label: {
      color: theme.colors.textPrimary,
    },
  }),
);

describe('createThemedStyles', () => {
  it.each([
    { color: lightTheme.colors.textPrimary, mode: 'light' },
    { color: darkTheme.colors.textPrimary, mode: 'dark' },
  ] satisfies ReadonlyArray<{ color: string; mode: ThemeMode }>)(
    '$mode 모드의 theme으로 스타일을 생성한다',
    async ({ color, mode }) => {
      await render(
        <ThemeProvider mode={mode}>
          <ThemeStyleProbe mode={mode} />
        </ThemeProvider>,
      );

      expect(screen.getByText(mode)).toHaveStyle({ color });
    },
  );

  it('같은 theme에서는 스타일을 재사용하고 theme 변경 시 다시 생성한다', async () => {
    const result = await render(
      <ThemeProvider mode="light">
        <ThemeStyleProbe mode="light" />
      </ThemeProvider>,
    );
    const lightStyle = screen.getByText('light').props.style;

    await result.rerender(
      <ThemeProvider mode="light">
        <ThemeStyleProbe mode="light" />
      </ThemeProvider>,
    );

    expect(screen.getByText('light').props.style).toBe(lightStyle);

    await result.rerender(
      <ThemeProvider mode="dark">
        <ThemeStyleProbe mode="dark" />
      </ThemeProvider>,
    );

    expect(screen.getByText('dark').props.style).not.toBe(lightStyle);
    expect(screen.getByText('dark')).toHaveStyle({ color: darkTheme.colors.textPrimary });
  });
});

function ThemeStyleProbe({ mode }: { mode: ThemeMode }) {
  const styles = useStyles();

  return <Text style={styles.label}>{mode}</Text>;
}
