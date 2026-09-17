import { Pressable, StyleSheet, View } from 'react-native';

import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { createThemedStyles } from '@/shared/ui/theme-provider';

type Props = {
  openTitleDialog: () => void;
};

export function RecordingButton({ openTitleDialog }: Props) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityLabel={UI_STRINGS.meetingLibrary.newRecording}
      accessibilityRole="button"
      onPress={openTitleDialog}
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
