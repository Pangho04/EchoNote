import type { ColorSchemeName } from 'react-native';

import { darkTheme, lightTheme } from './themes';
import type { AppTheme } from './types';

export function resolveTheme(colorScheme: ColorSchemeName | null): AppTheme {
  if (colorScheme === 'dark') return darkTheme;

  return lightTheme;
}
