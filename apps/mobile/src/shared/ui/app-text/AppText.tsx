import { StyleSheet, Text, type TextProps } from 'react-native';

import { createThemedStyles } from '@/shared/ui/theme-provider';

type AppTextVariant = 'body' | 'caption' | 'display' | 'reading' | 'title';

type AppTextColor =
  'accent' | 'recording' | 'success' | 'textPrimary' | 'textSecondary' | 'textTertiary' | 'warning';

type AppTextProps = TextProps & {
  color?: AppTextColor;
  variant: AppTextVariant;
};

export function AppText({
  children,
  color = 'textPrimary',
  style,
  variant,
  ...textProps
}: AppTextProps) {
  const styles = useStyles();

  return (
    <Text {...textProps} style={[styles.variants[variant], styles.colors[color], style]}>
      {children}
    </Text>
  );
}

const useStyles = createThemedStyles((theme) => ({
  colors: StyleSheet.create({
    accent: { color: theme.colors.accent },
    recording: { color: theme.colors.recording },
    success: { color: theme.colors.success },
    textPrimary: { color: theme.colors.textPrimary },
    textSecondary: { color: theme.colors.textSecondary },
    textTertiary: { color: theme.colors.textTertiary },
    warning: { color: theme.colors.warning },
  }),
  variants: StyleSheet.create({
    body: {
      fontSize: theme.typography.fontSize.body,
      fontWeight: theme.typography.fontWeight.regular,
      lineHeight: theme.typography.lineHeight.body,
    },
    caption: {
      fontSize: theme.typography.fontSize.caption,
      fontWeight: theme.typography.fontWeight.regular,
      lineHeight: theme.typography.lineHeight.caption,
    },
    display: {
      fontSize: theme.typography.fontSize.largeTitle,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: theme.typography.lineHeight.largeTitle,
    },
    reading: {
      fontSize: theme.typography.fontSize.body,
      fontWeight: theme.typography.fontWeight.regular,
      lineHeight: theme.typography.lineHeight.reading,
    },
    title: {
      fontSize: theme.typography.fontSize.title,
      fontWeight: theme.typography.fontWeight.semibold,
      lineHeight: theme.typography.lineHeight.title,
    },
  }),
}));
