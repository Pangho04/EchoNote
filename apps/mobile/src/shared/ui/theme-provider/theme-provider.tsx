import { StatusBar } from 'expo-status-bar';
import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { type AppTheme, resolveTheme, type ThemeMode } from '@/shared/config/theme';

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

  return (
    <ThemeContext.Provider value={value}>
      {/* 상태바 아이콘 색을 지정하지 않으면 Android는 라이트 테마에서도 흰 아이콘을 그려 헤더에 묻힌다. */}
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useTheme은 ThemeProvider 내부에서 사용해야 합니다.');
  }

  return value.theme;
}
