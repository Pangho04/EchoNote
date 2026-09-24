import { Pressable, StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

type Props = {
  selectedCount: number;
  disabled: boolean;
  onDeletePress: () => void;
};

export function MeetingEditToolbar({ selectedCount, disabled, onDeletePress }: Props) {
  const styles = useStyles();
  const deleteDisabled = disabled || selectedCount === 0;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={UI_STRINGS.meetingLibrary.deleteSelectedLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: deleteDisabled }}
        disabled={deleteDisabled}
        hitSlop={5}
        onPress={onDeletePress}
        style={styles.button}
      >
        <AppText color={deleteDisabled ? 'textTertiary' : 'recording'} variant="body">
          {`${UI_STRINGS.meetingLibrary.delete} (${selectedCount})`}
        </AppText>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      marginHorizontal: 18,
      marginBottom: theme.spacing[2],
    },
    button: {
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 44,
    },
  }),
);
