import { SquarePen } from 'lucide-react-native';
import { type ReactElement, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

export interface RecordingTitleInlineProps {
  value: string;
  onChangeText(text: string): void;
  editable: boolean;
}

const EDIT_ICON_SIZE = 18;

// 녹음 화면 타이머 위의 밑줄형 제목 입력. 연필 아이콘은 편집 가능하다는 표시일 뿐 누를 대상이 아니다.
export function RecordingTitleInline(props: RecordingTitleInlineProps): ReactElement {
  const { value, onChangeText, editable } = props;
  const styles = useStyles();
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.titleRow, isFocused && styles.titleRowFocused]}>
      <TextInput
        accessibilityLabel={UI_STRINGS.recording.titleLabel}
        editable={editable}
        onBlur={() => setIsFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        placeholder={UI_STRINGS.recording.titlePlaceholder}
        placeholderTextColor={colors.textTertiary}
        // 한 줄 입력이라 return 키가 곧 키보드 닫기다. 키보드가 녹음 컨트롤을 가리는 것을 막는다.
        returnKeyType="done"
        style={[styles.input, isFocused && styles.inputFocused]}
        value={value}
      />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SquarePen color={colors.textTertiary} size={EDIT_ICON_SIZE} strokeWidth={2} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    titleRow: {
      alignItems: 'center',
      alignSelf: 'center',
      borderBottomColor: theme.colors.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      gap: theme.spacing[1],
      maxWidth: 280,
      // 오른쪽 아이콘 폭만큼 왼쪽을 비워 제목 글자를 화면 중앙에 맞춘다.
      paddingLeft: EDIT_ICON_SIZE + theme.spacing[1],
      width: '100%',
    },
    titleRowFocused: {
      borderBottomColor: theme.colors.accent,
    },
    input: {
      color: theme.colors.textSecondary,
      flex: 1,
      fontSize: theme.typography.fontSize.body,
      minWidth: 0,
      paddingBottom: 7,
      paddingHorizontal: theme.spacing[2],
      paddingTop: 5,
      textAlign: 'center',
    },
    inputFocused: {
      color: theme.colors.textPrimary,
    },
  }),
);
