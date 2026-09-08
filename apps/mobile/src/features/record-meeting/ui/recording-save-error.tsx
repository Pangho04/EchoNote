import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingSaveErrorProps {
  message: string;
  onRetry(): void;
}

export function RecordingSaveError(props: RecordingSaveErrorProps): ReactElement {
  const { message, onRetry } = props;
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.message} variant="body">
        {message}
      </AppText>
      <Pressable
        accessibilityLabel="다시 시도"
        accessibilityRole="button"
        accessibilityState={{ disabled: false }}
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        <AppText color="accent" variant="body">
          다시 시도
        </AppText>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      gap: theme.spacing[3],
    },
    message: {
      textAlign: 'center',
    },
    retryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing[2],
    },
    pressed: {
      opacity: 0.7,
    },
  }),
);
