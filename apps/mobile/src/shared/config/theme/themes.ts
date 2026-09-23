import { motion, palette, radii, spacing, typography } from './primitives';
import type { AppTheme } from './types';

const commonTheme = {
  motion,
  radii,
  spacing,
  typography,
};

export const lightTheme: AppTheme = {
  ...commonTheme,
  colors: {
    accent: palette.accentLight,
    accentMuted: palette.accentLightMuted,
    background: palette.gray200,
    border: palette.gray300,
    playbackBar: palette.playbackBarLight,
    recording: palette.recordingLight,
    recordingMuted: palette.recordingLightMuted,
    success: palette.successLight,
    surface: palette.white,
    surfaceMuted: palette.gray100,
    textPrimary: palette.graphite,
    textSecondary: palette.gray600,
    textTertiary: palette.gray500,
    warning: palette.warningLight,
  },
  mode: 'light',
};

export const darkTheme: AppTheme = {
  ...commonTheme,
  colors: {
    accent: palette.accentDark,
    accentMuted: palette.accentDarkMuted,
    background: palette.black,
    border: palette.gray800,
    playbackBar: palette.playbackBarDark,
    recording: palette.recordingDark,
    recordingMuted: palette.recordingDarkMuted,
    success: palette.successDark,
    surface: palette.gray900,
    surfaceMuted: palette.gray850,
    textPrimary: palette.gray100,
    textSecondary: '#B5B5BB',
    textTertiary: '#84848C',
    warning: palette.warningDark,
  },
  mode: 'dark',
};
