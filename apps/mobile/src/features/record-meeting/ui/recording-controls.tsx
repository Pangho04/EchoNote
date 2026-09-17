import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingControlsProps {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

// 녹음 화면 중앙의 단일 원형 버튼(내부 도형이 단계에 따라 변화) + 작은 종료 버튼.
export function RecordingControls(props: RecordingControlsProps): ReactElement {
  const { canPause, canResume, canStop, onPause, onResume, onStop } = props;
  const styles = useStyles();

  // 녹음 중(pause 가능)이면 일시정지, 일시정지 상태면 재개, 그 외엔 비활성.
  const isPausing = canPause;
  const isResuming = canResume;

  const onToggle = isPausing ? onPause : isResuming ? onResume : undefined;
  const toggleEnabled = isPausing || isResuming;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={isPausing ? UI_STRINGS.recording.pause : UI_STRINGS.recording.resume}
        accessibilityRole="button"
        accessibilityState={{ disabled: !toggleEnabled }}
        disabled={!toggleEnabled}
        hitSlop={12}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.toggleButton,
          !toggleEnabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {isPausing ? (
          <View style={styles.pauseIcon}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : (
          <View style={styles.resumeIcon} />
        )}
      </Pressable>

      <Pressable
        accessibilityLabel={UI_STRINGS.recording.stop}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canStop }}
        disabled={!canStop}
        hitSlop={12}
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
      gap: theme.spacing[5],
      justifyContent: 'center',
    },
    toggleButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.recording,
      borderRadius: theme.radii.round,
      height: 72,
      justifyContent: 'center',
      width: 72,
    },
    pauseIcon: {
      flexDirection: 'row',
      gap: 7,
    },
    pauseBar: {
      backgroundColor: palette.white,
      borderRadius: 2,
      height: 24,
      width: 7,
    },
    resumeIcon: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 12,
      borderLeftColor: palette.white,
      borderLeftWidth: 20,
      borderTopColor: 'transparent',
      borderTopWidth: 12,
      height: 0,
      marginLeft: 5,
      width: 0,
    },
    stopButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.recording,
      borderRadius: theme.radii.round,
      borderWidth: 2,
      height: 56,
      justifyContent: 'center',
      width: 56,
    },
    stopIndicator: {
      backgroundColor: theme.colors.recording,
      borderRadius: 3,
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
