import type { motion, radii, spacing, typography } from './primitives';

export type ThemeMode = 'light' | 'dark';

export type ThemeColors = {
  accent: string;
  accentMuted: string;
  accentPressed: string;
  background: string;
  border: string;
  playbackBar: string;
  recording: string;
  recordingMuted: string;
  recordingPressed: string;
  success: string;
  surface: string;
  surfaceMuted: string;
  surfacePressed: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  warning: string;
};

export type AppTheme = {
  colors: ThemeColors;
  mode: ThemeMode;
  motion: typeof motion;
  radii: typeof radii;
  spacing: typeof spacing;
  typography: typeof typography;
};
