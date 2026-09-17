import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface PlaybackControlsProps {
  positionLabel: string;
  durationLabel: string;
  errorMessage: string | null;
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  onPlay(): void;
  onPause(): void;
  onSeekBackward(): void;
  onSeekForward(): void;
}

// 현재/전체 시간 한 줄과 -10초·재생/정지·+10초 버튼 세 개. Slider는 두지 않는다.
export function PlaybackControls(props: PlaybackControlsProps): ReactElement {
  const {
    positionLabel,
    durationLabel,
    errorMessage,
    canPlay,
    canPause,
    canSeek,
    onPlay,
    onPause,
    onSeekBackward,
    onSeekForward,
  } = props;
  const styles = useStyles();

  const toggleEnabled = canPlay || canPause;

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.time} variant="caption">
        {positionLabel} / {durationLabel}
      </AppText>

      <View style={styles.row}>
        <Pressable
          accessibilityLabel={UI_STRINGS.playback.seekBackwardLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSeek }}
          disabled={!canSeek}
          hitSlop={12}
          onPress={onSeekBackward}
          style={({ pressed }) => [
            styles.seekButton,
            !canSeek && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AppText color="accent" variant="body">
            {UI_STRINGS.playback.seekBackward}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityLabel={
            canPause ? UI_STRINGS.playback.pauseLabel : UI_STRINGS.playback.playLabel
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: !toggleEnabled }}
          disabled={!toggleEnabled}
          hitSlop={12}
          onPress={canPause ? onPause : onPlay}
          style={({ pressed }) => [
            styles.toggleButton,
            !toggleEnabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {canPause ? (
            <View style={styles.pauseIcon}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playIcon} />
          )}
        </Pressable>

        <Pressable
          accessibilityLabel={UI_STRINGS.playback.seekForwardLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSeek }}
          disabled={!canSeek}
          hitSlop={12}
          onPress={onSeekForward}
          style={({ pressed }) => [
            styles.seekButton,
            !canSeek && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AppText color="accent" variant="body">
            {UI_STRINGS.playback.seekForward}
          </AppText>
        </Pressable>
      </View>

      {errorMessage !== null && (
        <AppText accessibilityRole="alert" color="warning" style={styles.error} variant="caption">
          {errorMessage}
        </AppText>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      gap: theme.spacing[4],
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[5],
    },
    time: {
      fontVariant: ['tabular-nums'],
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[5],
      justifyContent: 'center',
    },
    seekButton: {
      alignItems: 'center',
      borderColor: theme.colors.accent,
      borderRadius: theme.radii.round,
      borderWidth: 2,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    toggleButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radii.round,
      height: 64,
      justifyContent: 'center',
      width: 64,
    },
    pauseIcon: {
      flexDirection: 'row',
      gap: 6,
    },
    pauseBar: {
      backgroundColor: palette.white,
      borderRadius: 2,
      height: 22,
      width: 6,
    },
    playIcon: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 11,
      borderLeftColor: palette.white,
      borderLeftWidth: 18,
      borderTopColor: 'transparent',
      borderTopWidth: 11,
      height: 0,
      marginLeft: 4,
      width: 0,
    },
    error: {
      textAlign: 'center',
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
