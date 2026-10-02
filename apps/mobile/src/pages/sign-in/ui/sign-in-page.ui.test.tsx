import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { SignInPage } from './sign-in-page';

jest.mock('@/features/authenticate', () => ({
  SignInForm: () => null,
}));

describe('SignInPage', () => {
  it('이용 문의를 누르면 메일 작성 화면을 연다', async () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await render(
      <ThemeProvider mode="light">
        <SignInPage />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByRole('link'));

    expect(openUrlSpy).toHaveBeenCalledWith('mailto:lph6812@gmail.com');
  });

  it('메일 앱 열기가 실패해도 처리되지 않은 오류를 내지 않는다', async () => {
    const unhandledRejectionSpy = jest.fn();

    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    process.on('unhandledRejection', unhandledRejectionSpy);

    try {
      await render(
        <ThemeProvider mode="light">
          <SignInPage />
        </ThemeProvider>,
      );

      await fireEvent.press(screen.getByRole('link'));
      // catch되지 않은 reject는 다음 tick의 unhandledRejection 이벤트로 드러나므로 한 번 더 기다린다.
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandledRejectionSpy).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejectionSpy);
    }
  });

  it('키보드가 열려 있어도 첫 탭으로 바로 눌리도록 keyboardShouldPersistTaps를 handled로 둔다', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await render(
      <ThemeProvider mode="light">
        <SignInPage />
      </ThemeProvider>,
    );

    expect(findKeyboardShouldPersistTaps(screen.toJSON())).toBe('handled');
  });
});

type JsonNode = NonNullable<ReturnType<typeof screen.toJSON>>;

function findKeyboardShouldPersistTaps(node: JsonNode | JsonNode[] | null): unknown {
  if (node == null) return undefined;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findKeyboardShouldPersistTaps(child);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  if ('keyboardShouldPersistTaps' in node.props) return node.props.keyboardShouldPersistTaps;

  return findKeyboardShouldPersistTaps(node.children as JsonNode[] | null);
}
