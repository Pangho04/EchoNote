import type { ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingTitleEditorProps {
  value: string;
  onChangeText(text: string): void;
  editable: boolean;
  autoFocus?: boolean;
}

export function RecordingTitleEditor(props: RecordingTitleEditorProps): ReactElement {
  const { value, onChangeText, editable, autoFocus = false } = props;
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.label} variant="caption">
        녹음 제목
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={UI_STRINGS.recording.titlePlaceholder}
        placeholderTextColor={styles.placeholder.color}
        editable={editable}
        autoFocus={autoFocus}
        // 한 줄 입력이라 return 키가 곧 키보드 닫기다. 키보드가 녹음 컨트롤을 가리는 것을 막는다.
        returnKeyType="done"
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
