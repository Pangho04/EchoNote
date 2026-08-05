import { useMemo } from 'react';

import type { AppTheme } from '@/shared/config/theme';

import { useTheme } from './theme-provider';

type StylesFactory<Styles> = (theme: AppTheme) => Styles;

export function createThemedStyles<Styles>(createStyles: StylesFactory<Styles>) {
  return function useThemedStyles() {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    return styles;
  };
}
