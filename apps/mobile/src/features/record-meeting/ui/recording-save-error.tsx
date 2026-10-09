import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { PressedHighlight } from '@/shared/ui/pressed-highlight';
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
        accessibilityLabel={UI_STRINGS.common.retry}
        accessibilityRole="button"
        accessibilityState={{ disabled: false }}
        onPress={onRetry}
        style={styles.retryButton}
      >
        {({ pressed }) => (
          <>
            <PressedHighlight pressed={pressed} />
            <AppText color="accent" variant="body">
              {UI_STRINGS.common.retry}
            </AppText>
          </>
        )}
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
  }),
);
