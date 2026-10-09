import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { lightTheme } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { ThemeProvider } from '@/shared/ui/theme-provider';

function pressIn(host: ReturnType<typeof screen.getByRole>) {
  fireEvent(host, 'responderGrant', {
    persist() {},
    nativeEvent: { timestamp: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0 },
    currentTarget: { measure() {} },
  });
}

import { useSession } from '../model/session-provider';
import { useSignInForm } from '../model/use-sign-in-form';
import { SignInForm } from './sign-in-form';

// password TextInput의 실제 ref에 걸린 focus 호출을 관찰하려고, TextInput의 imperative handle만
// 가짜로 바꾼다. 렌더링 자체는 실제 TextInput에 그대로 맡긴다.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  const OriginalTextInput = RN.TextInput;
  const SpyableTextInput = React.forwardRef((props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({
      focus: () => (globalThis as { __focusSpy?: () => void }).__focusSpy?.(),
      blur: () => {},
      clear: () => {},
    }));

    return React.createElement(OriginalTextInput, props);
  });

  Object.defineProperty(RN, 'TextInput', { value: SpyableTextInput, configurable: true });

  return RN;
});

jest.mock('../model/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

async function renderForm(signIn: jest.Mock) {
  mockedUseSession.mockReturnValue({
    state: { kind: 'signedOut', cause: 'user' },
    signIn,
    signOut: jest.fn(),
  });

  return render(
    <ThemeProvider mode="light">
      <SignInForm />
    </ThemeProvider>,
  );
}

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as { __focusSpy?: jest.Mock }).__focusSpy = jest.fn();
  });

  it('공백만 입력하면 버튼이 비활성 상태라 눌러도 signIn을 호출하지 않는다', async () => {
    const signIn = jest.fn();

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), '   ');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), '   ');
    await fireEvent.press(screen.getByRole('button'));

    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('이메일 앞뒤 공백을 지우고 signIn을 호출한다', async () => {
    const signIn = jest.fn(() => new Promise(() => {}));

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), '  a@b.c  ');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
    await fireEvent.press(screen.getByRole('button'));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ email: 'a@b.c', password: 'secret1' }),
    );
  });

  it('signIn이 실패하면 실패 문구를 보여주고 입력값을 유지하며 iOS에서 낭독하고 제출 중 상태를 푼다', async () => {
    const signIn = jest.fn(() => Promise.reject(new Error('invalid credentials')));
    const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
    await fireEvent.press(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(UI_STRINGS.auth.signInFailed)).toBeOnTheScreen());
    expect(screen.getByLabelText(UI_STRINGS.auth.email).props.value).toBe('a@b.c');
    expect(screen.getByLabelText(UI_STRINGS.auth.password).props.value).toBe('secret1');
    expect(announceSpy).toHaveBeenCalledWith(UI_STRINGS.auth.signInFailed);
    expect(screen.getByRole('button')).not.toBeDisabled();
    expect(screen.getByText(UI_STRINGS.auth.signIn)).toBeOnTheScreen();
  });

  it('재제출하면 이전 실패 문구가 사라진다', async () => {
    const signIn = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('invalid credentials')))
      .mockImplementationOnce(() => new Promise(() => {}));

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
    await fireEvent.press(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(UI_STRINGS.auth.signInFailed)).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole('button'));

    await waitFor(() => expect(screen.queryByText(UI_STRINGS.auth.signInFailed)).toBeNull());
  });

  it('제출 중엔 버튼이 비활성화되고 진행 중 라벨을 보여주며 입력을 잠근다', async () => {
    const signIn = jest.fn(() => new Promise(() => {}));

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
    await fireEvent.press(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(UI_STRINGS.auth.signingIn)).toBeOnTheScreen());
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByLabelText(UI_STRINGS.auth.email).props.editable).toBe(false);
    expect(screen.getByLabelText(UI_STRINGS.auth.password).props.editable).toBe(false);
  });

  it('같은 tick에 submit을 두 번 불러도 signIn은 한 번만 호출한다', async () => {
    const signIn = jest.fn(() => new Promise<void>(() => {}));

    mockedUseSession.mockReturnValue({
      state: { kind: 'signedOut', cause: 'user' },
      signIn,
      signOut: jest.fn(),
    });

    const { result } = await renderHook(() => useSignInForm());

    await act(async () => {
      result.current.setEmail('a@b.c');
      result.current.setPassword('secret1');
    });

    await act(async () => {
      result.current.submit();
      result.current.submit();
    });

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('Android에서 signIn이 실패해도 announceForAccessibility를 부르지 않는다', async () => {
    const signIn = jest.fn(() => Promise.reject(new Error('invalid credentials')));
    const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const originalOS = Platform.OS;

    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });

      await renderForm(signIn);
      await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
      await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
      await fireEvent.press(screen.getByRole('button'));

      await waitFor(() => expect(screen.getByText(UI_STRINGS.auth.signInFailed)).toBeOnTheScreen());
      expect(announceSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });

  it('이메일에서 submitEditing하면 비밀번호로 포커스를 옮기고, 비밀번호에서 submitEditing하면 제출한다', async () => {
    const signIn = jest.fn(() => new Promise(() => {}));

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');
    await fireEvent(screen.getByLabelText(UI_STRINGS.auth.email), 'submitEditing');

    expect((globalThis as { __focusSpy?: jest.Mock }).__focusSpy).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();

    await fireEvent(screen.getByLabelText(UI_STRINGS.auth.password), 'submitEditing');

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ email: 'a@b.c', password: 'secret1' }),
    );
  });

  it('누르는 동안 로그인 버튼 배경이 눌림 토큰 색이다', async () => {
    const signIn = jest.fn();

    await renderForm(signIn);
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.email), 'a@b.c');
    await fireEvent.changeText(screen.getByLabelText(UI_STRINGS.auth.password), 'secret1');

    const button = screen.getByRole('button');

    await act(async () => pressIn(button));

    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.accentPressed });
  });
});
