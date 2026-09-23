import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface PlaybackControlsProps {
  positionLabel: string;
  durationLabel: string;
  progressRatio: number;
  errorMessage: string | null;
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  onPlay(): void;
  onPause(): void;
  onSeekBackward(): void;
  onSeekForward(): void;
}

// 위에서 아래로 진행 막대(표시 전용)·현재/전체 시간·-10초·재생/정지·+10초 버튼 순으로 쌓는다. Slider는 두지 않는다.
export function PlaybackControls(props: PlaybackControlsProps): ReactElement {
  const {
    positionLabel,
    durationLabel,
    progressRatio,
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
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${progressRatio * 100}%` }]}>
          <View style={styles.fillHighlight} />
        </View>
      </View>

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
          <View style={styles.seekIcon}>
            <View style={styles.seekArc} />
            <View style={styles.seekArrow} />
          </View>
          <View pointerEvents="none" style={styles.seekLabelBox}>
            <AppText color="accent" style={styles.seekLabel} variant="caption">
              {UI_STRINGS.playback.seekBackward}
            </AppText>
          </View>
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
          <View style={[styles.seekIcon, styles.seekIconMirrored]}>
            <View style={styles.seekArc} />
            <View style={styles.seekArrow} />
          </View>
          <View pointerEvents="none" style={styles.seekLabelBox}>
            <AppText color="accent" style={styles.seekLabel} variant="caption">
              {UI_STRINGS.playback.seekForward}
            </AppText>
          </View>
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
    track: {
      alignSelf: 'stretch',
      backgroundColor: theme.colors.border,
      borderRadius: theme.radii.round,
      height: 6,
      overflow: 'hidden',
    },
    fill: {
      backgroundColor: theme.colors.playbackBar,
      borderRadius: theme.radii.round,
      height: '100%',
    },
    fillHighlight: {
      backgroundColor: 'rgba(255,255,255,0.35)',
      height: 1,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
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
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    seekIcon: {
      height: 36,
      width: 36,
    },
    seekIconMirrored: {
      transform: [{ scaleX: -1 }],
    },
    seekArc: {
      borderColor: theme.colors.accent,
      borderRadius: 18,
      borderTopColor: 'transparent',
      borderWidth: 2,
      height: 36,
      transform: [{ rotate: '-45deg' }],
      width: 36,
    },
    seekArrow: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 6,
      borderRightColor: theme.colors.accent,
      borderRightWidth: 7,
      borderTopColor: 'transparent',
      borderTopWidth: 6,
      height: 0,
      left: 15,
      position: 'absolute',
      top: -5,
      width: 0,
    },
    // textAlignVertical은 Android 전용이라 iOS에서도 가운데 오도록 감싼 View가 정렬한다.
    seekLabelBox: {
      alignItems: 'center',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    seekLabel: {
      fontVariant: ['tabular-nums'],
      fontWeight: theme.typography.fontWeight.semibold,
      lineHeight: 12,
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
