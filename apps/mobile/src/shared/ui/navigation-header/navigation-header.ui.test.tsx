import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { NavigationHeader } from './navigation-header';

describe('NavigationHeader', () => {
  it('action이 없으면 제목만 보인다', async () => {
    await render(
      <ThemeProvider mode="light">
        <NavigationHeader title="회의" titleVariant="display" />
      </ThemeProvider>,
    );

    expect(screen.getByRole('header')).toHaveTextContent('회의');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('action을 누르면 onPress를 부른다', async () => {
    const onPress = jest.fn();

    await render(
      <ThemeProvider mode="light">
        <NavigationHeader
          title="새 회의"
          action={{ label: '취소', accessibilityLabel: '녹음 취소', onPress }}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByLabelText('녹음 취소'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('비활성 trailingAction은 눌러도 onPress를 부르지 않는다', async () => {
    const onPress = jest.fn();

    await render(
      <ThemeProvider mode="light">
        <NavigationHeader
          title="회의"
          trailingAction={{
            label: '편집',
            accessibilityLabel: '편집 시작',
            onPress,
            disabled: true,
          }}
        />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByLabelText('편집 시작'));

    expect(onPress).not.toHaveBeenCalled();
  });
});
