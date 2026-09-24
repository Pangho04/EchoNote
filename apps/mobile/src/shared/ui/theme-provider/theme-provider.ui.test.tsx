import { render, screen } from '@testing-library/react-native';
import type * as ReactNative from 'react-native';
import { Text } from 'react-native';

import { ThemeProvider, useTheme } from './theme-provider';

// RN StatusBar는 host 요소를 그리지 않으므로 전달한 style을 텍스트로 드러내는 대역으로 바꾼다.
jest.mock('expo-status-bar', () => {
  const { Text: MockText } = jest.requireActual<typeof ReactNative>('react-native');

  return {
    StatusBar: ({ style }: { style: string }) => <MockText>{`status-bar:${style}`}</MockText>,
  };
});

describe('ThemeProvider', () => {
  it('지정한 색상 모드를 하위 컴포넌트에 제공한다', async () => {
    await render(
      <ThemeProvider mode="dark">
        <ThemeModeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText('dark')).toBeOnTheScreen();
  });

  it.each([
    ['dark', 'light'],
    ['light', 'dark'],
  ] as const)('%s 모드면 상태바 아이콘을 %s로 그린다', async (mode, style) => {
    await render(<ThemeProvider mode={mode} />);

    expect(screen.getByText(`status-bar:${style}`)).toBeOnTheScreen();
  });
});

function ThemeModeProbe() {
  const theme = useTheme();

  return <Text>{theme.mode}</Text>;
}
