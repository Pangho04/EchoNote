import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { ToastProvider, useToast } from './toast-provider';

jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock');

  return mock.default ?? mock;
});

describe('ToastProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('showToast 호출 시 메시지가 표시된다', async () => {
    await render(
      <Wrapper>
        <ToastTrigger message="저장되었습니다" />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('토스트 띄우기'));

    expect(screen.getByText('저장되었습니다')).toBeOnTheScreen();
  });

  it('지정한 시간이 지나면 토스트가 사라진다', async () => {
    await render(
      <Wrapper>
        <ToastTrigger message="저장되었습니다" />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('토스트 띄우기'));

    expect(screen.getByText('저장되었습니다')).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(2400);
    });

    expect(screen.queryByText('저장되었습니다')).toBeNull();
  });

  it('ToastProvider 밖에서 useToast를 호출하면 오류를 던진다', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(render(<UnwrappedToastConsumer />)).rejects.toThrow(
      'useToast는 ToastProvider 내부에서 사용해야 합니다.',
    );

    consoleErrorSpy.mockRestore();
  });
});

function Wrapper({ children }: PropsWithChildren): ReactElement {
  return (
    <SafeAreaProvider>
      <ThemeProvider mode="light">
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ToastTrigger({ message }: { message: string }): ReactElement {
  const { showToast } = useToast();

  return (
    <Pressable onPress={() => showToast(message)}>
      <Text>토스트 띄우기</Text>
    </Pressable>
  );
}

function UnwrappedToastConsumer(): ReactElement {
  useToast();

  return <Text>never</Text>;
}
