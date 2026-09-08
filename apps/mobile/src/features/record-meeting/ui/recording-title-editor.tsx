import type { ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingTitleEditorProps {
  value: string;
  onChangeText(text: string): void;
  editable: boolean;
}

export function RecordingTitleEditor(props: RecordingTitleEditorProps): ReactElement {
  const { value, onChangeText, editable } = props;
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.label} variant="caption">
        녹음 제목
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="기본 이름으로 저장"
        placeholderTextColor={styles.placeholder.color}
        editable={editable}
        style={styles.input}
      />
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      gap: theme.spacing[2],
    },
    label: {
      marginBottom: theme.spacing[1],
    },
    input: {
      borderColor: theme.colors.border,
      borderRadius: theme.radii.item,
      borderWidth: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.typography.fontSize.body,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    placeholder: {
      color: theme.colors.textTertiary,
    },
  }),
);
