export const palette = {
  black: '#000000',
  graphite: '#161617',
  gray100: '#F5F5F7',
  gray200: '#F2F2F7',
  gray300: '#E5E5EA',
  gray400: '#D1D1D6',
  gray500: '#6E6E73',
  gray600: '#68686D',
  gray700: '#3A3A3C',
  gray800: '#2C2C2E',
  gray850: '#262629',
  gray900: '#1C1C1E',
  white: '#FFFFFF',
  accentLight: '#4059C7',
  accentLightMuted: '#E9EDFF',
  accentLightPressed: '#3A50B3',
  accentDark: '#8DA0FF',
  accentDarkMuted: '#30375A',
  accentDarkPressed: '#7A8BE0',
  playbackBarLight: '#5B7CF0',
  playbackBarDark: '#9FB2FF',
  recordingLight: '#D33844',
  recordingLightMuted: '#FFEBED',
  recordingLightPressed: '#BE323D',
  recordingDark: '#FF6670',
  recordingDarkMuted: '#512C31',
  recordingDarkPressed: '#E65C65',
  successLight: '#21865A',
  successDark: '#66C99B',
  warningLight: '#A96716',
  warningDark: '#E2AB62',
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radii = {
  control: 10,
  item: 8,
  sheet: 22,
  round: 999,
} as const;

export const typography = {
  fontSize: {
    caption: 11,
    label: 12,
    body: 15,
    title: 17,
    heading: 22,
    largeTitle: 30,
    timer: 52,
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    caption: 15,
    label: 17,
    body: 22,
    title: 23,
    heading: 29,
    largeTitle: 36,
    timer: 60,
    reading: 25,
  },
} as const;

export const motion = {
  fast: 160,
  standard: 240,
  deliberate: 280,
} as const;
