import { act, fireEvent, render } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { lightTheme } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { PlaybackControls, type PlaybackControlsProps } from './playback-controls';

function pressIn(host: TestInstance) {
  fireEvent(host, 'responderGrant', {
    persist() {},
    nativeEvent: { timestamp: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0 },
    currentTarget: { measure() {} },
  });
}

async function renderControls(overrides: Partial<PlaybackControlsProps> = {}) {
  const props: PlaybackControlsProps = {
    positionLabel: '0:20',
    durationLabel: '1:00',
    progressRatio: 0.33,
    errorMessage: null,
    canPlay: true,
    canPause: false,
    canSeek: true,
    onPlay: jest.fn(),
    onPause: jest.fn(),
    onSeekBackward: jest.fn(),
    onSeekForward: jest.fn(),
    ...overrides,
  };

  const utils = await render(
    <ThemeProvider mode="light">
      <PlaybackControls {...props} />
    </ThemeProvider>,
  );

  return { ...utils, props };
}

describe('PlaybackControls', () => {
  it('현재/전체 시간을 한 줄로 보여주고 세 버튼이 각 callback을 부른다', async () => {
    const { getByText, getByLabelText, props } = await renderControls();

    expect(getByText('0:20 / 1:00')).toBeTruthy();
    expect(getByText('-10')).toBeTruthy();
    expect(getByText('+10')).toBeTruthy();

    await fireEvent.press(getByLabelText('10초 뒤로'));
    await fireEvent.press(getByLabelText('재생'));
    await fireEvent.press(getByLabelText('10초 앞으로'));

    expect(props.onSeekBackward).toHaveBeenCalledTimes(1);
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onSeekForward).toHaveBeenCalledTimes(1);
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it('canPause면 가운데 버튼이 정지가 되어 onPause를 부른다', async () => {
    const { getByLabelText, queryByLabelText, props } = await renderControls({
      canPlay: false,
      canPause: true,
    });

    expect(queryByLabelText('재생')).toBeNull();

    await fireEvent.press(getByLabelText('정지'));

    expect(props.onPause).toHaveBeenCalledTimes(1);
    expect(props.onPlay).not.toHaveBeenCalled();
  });

  it('canSeek·canPlay가 false면 버튼이 비활성이고 눌러도 callback이 없다', async () => {
    const { getByLabelText, props } = await renderControls({ canPlay: false, canSeek: false });

    await fireEvent.press(getByLabelText('10초 뒤로'));
    await fireEvent.press(getByLabelText('재생'));
    await fireEvent.press(getByLabelText('10초 앞으로'));

    expect(getByLabelText('재생').props.accessibilityState).toEqual({ disabled: true });
    expect(props.onSeekBackward).not.toHaveBeenCalled();
    expect(props.onPlay).not.toHaveBeenCalled();
    expect(props.onSeekForward).not.toHaveBeenCalled();
  });

  it('errorMessage가 있으면 alert 텍스트로 보여준다', async () => {
    const { getByRole } = await renderControls({ errorMessage: '파일을 열 수 없습니다.' });

    expect(getByRole('alert')).toHaveTextContent('파일을 열 수 없습니다.');
  });

  it('누르는 동안 -10 버튼 배경이 눌림 토큰 색이다', async () => {
    const { getByLabelText } = await renderControls();
    const host = getByLabelText('10초 뒤로');

    await act(async () => pressIn(host));

    expect(host).toHaveStyle({ backgroundColor: lightTheme.colors.surfacePressed });
  });
});
