import { Pressable, StyleSheet, View } from 'react-native';

import { palette } from '@/shared/config/theme';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export function CreateMeetingButton() {
  const styles = useStyles();

  function handlePress() {
    console.log('새 회의 녹음 시작');
  }

  return (
    <Pressable
      accessibilityLabel="새 회의 녹음"
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.indicator} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: theme.colors.recording,
      borderRadius: theme.radii.round,
      height: 58,
      justifyContent: 'center',
      width: 58,
    },
    pressed: {
      opacity: 0.82,
      transform: [{ scale: 0.96 }],
    },
    indicator: {
      backgroundColor: palette.white,
      borderRadius: theme.radii.round,
      height: 18,
      width: 18,
    },
  }),
);
