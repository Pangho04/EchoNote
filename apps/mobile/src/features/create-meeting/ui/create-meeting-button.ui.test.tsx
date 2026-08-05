import { fireEvent, render, screen } from '@testing-library/react-native';

import { darkTheme, lightTheme, palette, type ThemeMode } from '@/shared/config/theme';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { CreateMeetingButton } from './create-meeting-button';

describe('CreateMeetingButton', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('녹음 시작 동작을 설명하는 접근성 버튼으로 표시한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <CreateMeetingButton />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: '새 회의 녹음' })).toBeOnTheScreen();
  });

  it.each([
    { color: lightTheme.colors.recording, mode: 'light' },
    { color: darkTheme.colors.recording, mode: 'dark' },
  ] satisfies ReadonlyArray<{ color: string; mode: ThemeMode }>)(
    '$mode 모드에서 녹음 의미 색상을 적용한다',
    async ({ color, mode }) => {
      await render(
        <ThemeProvider mode={mode}>
          <CreateMeetingButton />
        </ThemeProvider>,
      );

      expect(screen.getByRole('button', { name: '새 회의 녹음' })).toHaveStyle({
        backgroundColor: color,
      });
    },
  );

  it('58×58 원형 버튼 안에 18×18 흰색 원을 표시한다', async () => {
    await render(
      <ThemeProvider mode="light">
        <CreateMeetingButton />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button', { name: '새 회의 녹음' });
    const indicator = button.children[0];

    expect(button).toHaveStyle({
      borderRadius: lightTheme.radii.round,
      height: 58,
      width: 58,
    });
    expect(indicator).toHaveStyle({
      backgroundColor: palette.white,
      borderRadius: lightTheme.radii.round,
      height: 18,
      width: 18,
    });
  });

  it('눌린 동안 크기와 불투명도를 낮춘다', async () => {
    await render(
      <ThemeProvider mode="light">
        <CreateMeetingButton />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button', { name: '새 회의 녹음' });
    const pressEvent = {
      currentTarget: 1,
      nativeEvent: { pageX: 0, pageY: 0, timestamp: 0 },
      persist: jest.fn(),
    };

    await fireEvent(button, 'responderGrant', pressEvent);

    expect(button).toHaveStyle({
      opacity: 0.82,
      transform: [{ scale: 0.96 }],
    });

    await fireEvent(button, 'responderTerminate', pressEvent);
  });

  it('한 번 누르면 임시 녹음 시작 로그를 한 번만 남긴다', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await render(
      <ThemeProvider mode="light">
        <CreateMeetingButton />
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: '새 회의 녹음' }));

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith('새 회의 녹음 시작');
  });
});
