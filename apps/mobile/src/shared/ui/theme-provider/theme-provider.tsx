import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { useColorScheme } from 'react-native';

import { resolveTheme, type AppTheme, type ThemeMode } from '@/shared/config/theme';

type ThemeContextValue = {
  theme: AppTheme;
};

type ThemeProviderProps = PropsWithChildren<{
  mode?: ThemeMode;
}>;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, mode }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const theme = useMemo(() => resolveTheme(mode ?? systemColorScheme), [mode, systemColorScheme]);
  const value = useMemo(() => ({ theme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useTheme은 ThemeProvider 내부에서 사용해야 합니다.');
  }

  return value.theme;
}
