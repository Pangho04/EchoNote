import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingControlsProps {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

export function RecordingControls(props: RecordingControlsProps): ReactElement {
  const { canPause, canResume, canStop, onPause, onResume, onStop } = props;
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="일시 정지"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canPause }}
        disabled={!canPause}
        onPress={onPause}
        style={({ pressed }) => [
          styles.textButton,
          !canPause && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <AppText color={canPause ? 'accent' : 'textTertiary'} variant="body">
          일시 정지
        </AppText>
      </Pressable>

      <Pressable
        accessibilityLabel="재개"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canResume }}
        disabled={!canResume}
        onPress={onResume}
        style={({ pressed }) => [
          styles.textButton,
          !canResume && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <AppText color={canResume ? 'accent' : 'textTertiary'} variant="body">
          재개
        </AppText>
      </Pressable>

      <Pressable
        accessibilityLabel="녹음 중지"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canStop }}
        disabled={!canStop}
        onPress={onStop}
        style={({ pressed }) => [
          styles.stopButton,
          !canStop && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.stopIndicator} />
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    textButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing[2],
    },
    stopButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.recording,
      borderRadius: theme.radii.round,
      height: 58,
      justifyContent: 'center',
      width: 58,
    },
    stopIndicator: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.round,
      height: 18,
      width: 18,
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.82,
      transform: [{ scale: 0.96 }],
    },
  }),
);
