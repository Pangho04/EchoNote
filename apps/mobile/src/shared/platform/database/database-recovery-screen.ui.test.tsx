import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { lightTheme } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { DatabaseRecoveryScreen } from './database-recovery-screen';

function pressIn(host: TestInstance) {
  fireEvent(host, 'responderGrant', {
    persist() {},
    nativeEvent: { timestamp: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0 },
    currentTarget: { measure() {} },
  });
}

const onReset = jest.fn(async () => {});
const onRetry = jest.fn();

async function renderScreen(kind: 'corrupted' | 'unsupported-version' | 'unknown') {
  return render(
    <ThemeProvider mode="light">
      <DatabaseRecoveryScreen kind={kind} onReset={onReset} onRetry={onRetry} />
    </ThemeProvider>,
  );
}

describe('DatabaseRecoveryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('손상이면 초기화를 제안하고 누르면 onReset을 부른다', async () => {
    const { getByText } = await renderScreen('corrupted');

    expect(getByText('저장된 회의를 열 수 없습니다')).toBeOnTheScreen();

    await fireEvent.press(getByText('초기화하고 계속'));

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('앱보다 새 버전이면 초기화를 제안하지 않는다', async () => {
    const { getByText, queryByText } = await renderScreen('unsupported-version');

    expect(getByText('앱을 업데이트해 주세요')).toBeOnTheScreen();
    expect(queryByText('초기화하고 계속')).toBeNull();

    await fireEvent.press(getByText('다시 시도'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('원인을 모르면 다시 시도만 제안한다', async () => {
    const { getByText, queryByText } = await renderScreen('unknown');

    expect(getByText('앱을 시작하지 못했습니다')).toBeOnTheScreen();
    expect(queryByText('초기화하고 계속')).toBeNull();

    await fireEvent.press(getByText('다시 시도'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('누르는 동안 버튼 배경이 눌림 토큰 색이다', async () => {
    const { getByText } = await renderScreen('corrupted');
    const button = getByText('초기화하고 계속').parent as TestInstance;

    await act(async () => pressIn(button));

    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.surfacePressed });
  });
});
