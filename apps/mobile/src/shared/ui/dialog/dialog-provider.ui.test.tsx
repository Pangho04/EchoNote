import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { TestInstance } from 'test-renderer';

import { lightTheme } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

function pressIn(host: TestInstance) {
  fireEvent(host, 'responderGrant', {
    persist() {},
    nativeEvent: { timestamp: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0 },
    currentTarget: { measure() {} },
  });
}

import { type DialogOptions, DialogProvider, useDialog } from './dialog-provider';

jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock');

  return mock.default ?? mock;
});

describe('DialogProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('openDialog 호출 시 제목·본문·액션이 표시된다', async () => {
    await render(
      <Wrapper>
        <DialogTrigger
          options={{
            title: '회의를 열 수 없습니다',
            message: '회의를 찾을 수 없습니다.',
            actions: [{ label: '확인' }],
          }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    expect(screen.getByText('회의를 열 수 없습니다')).toBeOnTheScreen();
    expect(screen.getByText('회의를 찾을 수 없습니다.')).toBeOnTheScreen();
    expect(screen.getByText('확인')).toBeOnTheScreen();
  });

  it('액션을 누르면 팝업이 닫히고 onPress가 실행된다', async () => {
    const onPress = jest.fn();

    await render(
      <Wrapper>
        <DialogTrigger
          options={{ message: '삭제할까요?', actions: [{ label: '삭제', onPress }] }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));
    await fireEvent.press(screen.getByText('삭제'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('삭제할까요?')).toBeNull();
  });

  it('runActionsAfterClose면 iOS에서 Modal이 다 닫힌 뒤 onPress를 실행한다', async () => {
    const onPress = jest.fn();

    await render(
      <Wrapper>
        <DialogTrigger
          options={{
            message: '공유할까요?',
            actions: [{ label: '공유', onPress }],
            runActionsAfterClose: true,
          }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    // jest의 Modal은 숨겨지면 트리에서 빠지므로 onDismiss를 미리 잡아 둔다.
    const { onDismiss } = screen.getByTestId('dialog-modal').props;

    await fireEvent.press(screen.getByText('공유'));

    expect(screen.queryByText('공유할까요?')).toBeNull();
    expect(onPress).not.toHaveBeenCalled();

    await act(async () => onDismiss());

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('runActionsAfterClose여도 Android에서는 누르는 즉시 onPress를 실행한다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');

    const onPress = jest.fn();

    await render(
      <Wrapper>
        <DialogTrigger
          options={{
            message: '저장할까요?',
            actions: [{ label: '저장', onPress }],
            runActionsAfterClose: true,
          }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));
    await fireEvent.press(screen.getByText('저장'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('저장할까요?')).toBeNull();
  });

  it('닫히는 중에 새 팝업이 열리면 늦게 온 onDismiss는 새 팝업을 닫지 않고 액션도 버린다', async () => {
    const onPress = jest.fn();

    await render(
      <Wrapper>
        <DialogTrigger
          options={{
            message: '저장할까요?',
            actions: [{ label: '저장', onPress }],
            runActionsAfterClose: true,
          }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    const { onDismiss } = screen.getByTestId('dialog-modal').props;

    await fireEvent.press(screen.getByText('저장'));
    await fireEvent.press(screen.getByText('열기'));
    await act(async () => onDismiss());

    expect(screen.getByText('저장할까요?')).toBeOnTheScreen();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('닫히는 중에 온 뒤로 가기는 팝업 onDismiss를 부르지 않고 고른 액션만 실행한다', async () => {
    const onSave = jest.fn();
    const onDialogDismiss = jest.fn();

    await render(
      <Wrapper>
        <DialogTrigger
          options={{
            message: '저장할까요?',
            actions: [{ label: '저장', onPress: onSave }],
            runActionsAfterClose: true,
            onDismiss: onDialogDismiss,
          }}
        />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    const { onDismiss, onRequestClose } = screen.getByTestId('dialog-modal').props;

    await fireEvent.press(screen.getByText('저장'));
    await act(async () => onRequestClose());
    await act(async () => onDismiss());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDialogDismiss).not.toHaveBeenCalled();
  });

  it('content로 넘긴 컴포넌트를 그대로 그린다', async () => {
    await render(
      <Wrapper>
        <DialogTrigger options={{ content: <Text>제목 입력 폼</Text> }} />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    expect(screen.getByText('제목 입력 폼')).toBeOnTheScreen();
  });

  it('closeDialog로도 닫을 수 있다', async () => {
    await render(
      <Wrapper>
        <DialogTrigger options={{ message: '진행 중입니다.' }} />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));
    await fireEvent.press(screen.getByText('닫기'));

    expect(screen.queryByText('진행 중입니다.')).toBeNull();
  });

  it('누르는 동안 액션 버튼 배경이 눌림 토큰 색이다', async () => {
    await render(
      <Wrapper>
        <DialogTrigger options={{ message: '진행 중입니다.', actions: [{ label: '확인' }] }} />
      </Wrapper>,
    );

    await fireEvent.press(screen.getByText('열기'));

    const button = screen.getByText('확인').parent as TestInstance;

    await act(async () => pressIn(button));

    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.surfacePressed });
  });

  it('DialogProvider 밖에서 useDialog를 호출하면 오류를 던진다', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(render(<UnwrappedDialogConsumer />)).rejects.toThrow(
      'useDialog는 DialogProvider 내부에서 사용해야 합니다.',
    );

    consoleErrorSpy.mockRestore();
  });
});

function Wrapper({ children }: PropsWithChildren): ReactElement {
  return (
    <SafeAreaProvider>
      <ThemeProvider mode="light">
        <DialogProvider>{children}</DialogProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function DialogTrigger({ options }: { options: DialogOptions }): ReactElement {
  const { openDialog, closeDialog } = useDialog();

  return (
    <>
      <Pressable onPress={() => openDialog(options)}>
        <Text>열기</Text>
      </Pressable>

      <Pressable onPress={closeDialog}>
        <Text>닫기</Text>
      </Pressable>
    </>
  );
}

function UnwrappedDialogConsumer(): ReactElement {
  useDialog();

  return <Text>never</Text>;
}
