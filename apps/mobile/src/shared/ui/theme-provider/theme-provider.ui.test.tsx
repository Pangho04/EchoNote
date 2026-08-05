import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider, useTheme } from './theme-provider';

describe('ThemeProvider', () => {
  it('지정한 색상 모드를 하위 컴포넌트에 제공한다', async () => {
    await render(
      <ThemeProvider mode="dark">
        <ThemeModeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText('dark')).toBeOnTheScreen();
  });
});

function ThemeModeProbe() {
  const theme = useTheme();

  return <Text>{theme.mode}</Text>;
}
