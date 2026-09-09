import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

export interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps): ReactElement {
  const theme = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="none"
      style={[styles.container, { bottom: insets.bottom + theme.spacing[6] }]}
    >
      <AppText style={styles.message} variant="body">
        {message}
      </AppText>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: theme.colors.textPrimary,
      borderRadius: theme.radii.round,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
      position: 'absolute',
    },
    message: {
      color: theme.colors.surface,
    },
  }),
);
