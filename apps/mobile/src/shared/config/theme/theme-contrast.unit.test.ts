import { describe, expect, it } from 'vitest';

import { palette } from './primitives';
import { darkTheme, lightTheme } from './themes';

describe('theme text contrast', () => {
  it.each([
    ['light secondary', lightTheme.colors.textSecondary, lightTheme.colors.surface],
    ['light tertiary', lightTheme.colors.textTertiary, lightTheme.colors.surface],
    ['dark secondary', darkTheme.colors.textSecondary, darkTheme.colors.surface],
    ['dark tertiary', darkTheme.colors.textTertiary, darkTheme.colors.surface],
    ['light accent', lightTheme.colors.accent, lightTheme.colors.surface],
    ['light recording', lightTheme.colors.recording, lightTheme.colors.surface],
    ['light success', lightTheme.colors.success, lightTheme.colors.surface],
    ['light warning', lightTheme.colors.warning, lightTheme.colors.surface],
    ['dark accent', darkTheme.colors.accent, darkTheme.colors.surface],
    ['dark recording', darkTheme.colors.recording, darkTheme.colors.surface],
    ['dark success', darkTheme.colors.success, darkTheme.colors.surface],
    ['dark warning', darkTheme.colors.warning, darkTheme.colors.surface],
  ])('%s 색상이 surface에서 4.5:1 이상의 대비를 가진다', (_, foreground, background) => {
    expect(getContrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme pressed background contrast', () => {
  it.each([
    ['light textPrimary', lightTheme.colors.textPrimary, lightTheme.colors.surfacePressed],
    ['light textSecondary', lightTheme.colors.textSecondary, lightTheme.colors.surfacePressed],
    ['light textTertiary', lightTheme.colors.textTertiary, lightTheme.colors.surfacePressed],
    ['light accent', lightTheme.colors.accent, lightTheme.colors.surfacePressed],
    ['light recording', lightTheme.colors.recording, lightTheme.colors.surfacePressed],
    ['dark textPrimary', darkTheme.colors.textPrimary, darkTheme.colors.surfacePressed],
    ['dark textSecondary', darkTheme.colors.textSecondary, darkTheme.colors.surfacePressed],
    ['dark textTertiary', darkTheme.colors.textTertiary, darkTheme.colors.surfacePressed],
    ['dark accent', darkTheme.colors.accent, darkTheme.colors.surfacePressed],
    ['dark recording', darkTheme.colors.recording, darkTheme.colors.surfacePressed],
    ['white on light accentPressed', palette.white, lightTheme.colors.accentPressed],
    ['white on light recordingPressed', palette.white, lightTheme.colors.recordingPressed],
    ['white on dark accentPressed', palette.white, darkTheme.colors.accentPressed],
    ['white on dark recordingPressed', palette.white, darkTheme.colors.recordingPressed],
    [
      'dark surface on dark accentPressed',
      darkTheme.colors.surface,
      darkTheme.colors.accentPressed,
    ],
  ])('%s 색상이 눌림 배경에서 3:1 이상의 대비를 가진다', (_, foreground, background) => {
    expect(getContrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
  });
});

function getContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`지원하지 않는 색상 형식입니다: ${hex}`);
  }

  const linearChannels = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const red = getChannel(linearChannels, 0);
  const green = getChannel(linearChannels, 1);
  const blue = getChannel(linearChannels, 2);

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function getChannel(channels: number[], index: number) {
  const channel = channels[index];

  if (channel === undefined) {
    throw new Error(`색상 채널 ${index}을 확인할 수 없습니다.`);
  }

  return channel;
}
