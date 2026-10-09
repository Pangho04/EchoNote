import { Pressable, StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import type { MeetingListVMItem } from '../model/meeting';

type Props = {
  item: MeetingListVMItem;
  onPress: (meetingId: string) => void;
  // 값이 있으면 선택 모드다. 왼쪽에 체크를 그리고 오른쪽 표시를 숨긴다.
  selected?: boolean;
  // 스와이프를 쓰기 어려운 스크린 리더 사용자에게 같은 삭제 명령을 준다.
  onDelete?: (meetingId: string) => void;
  disabled?: boolean;
};

export function MeetingListItem({ item, onPress, selected, onDelete, disabled }: Props) {
  const styles = useStyles();
  const selecting = selected !== undefined;

  return (
    <Pressable
      accessibilityActions={
        onDelete ? [{ name: 'delete', label: UI_STRINGS.meetingLibrary.delete }] : undefined
      }
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      disabled={disabled}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') onDelete?.(item.id);
      }}
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [styles.container, pressed && styles.containerPressed]}
    >
      {selecting && (
        <View style={[styles.check, selected && styles.checkSelected]} testID="meeting-row-check">
          {selected && (
            <AppText style={styles.checkMark} variant="caption">
              ✓
            </AppText>
          )}
        </View>
      )}

      {/** 날짜 */}
      <View style={styles.dateTile}>
        <AppText color="recording" style={styles.month} variant="caption">
          {item.monthLabel}
        </AppText>
        <AppText style={styles.day} variant="body">
          {item.dayLabel}
        </AppText>
      </View>

      {/** 타이틀 */}
      <View style={styles.content}>
        <AppText numberOfLines={1} style={styles.title} variant="body">
          {item.title}
        </AppText>
        <AppText color="textSecondary" numberOfLines={1} variant="caption">
          {item.metaLabel}
        </AppText>
      </View>

      {/** 상태 chip 또는 상세 이동 표시. 선택 모드에서는 누르면 이동하지 않으므로 숨긴다. */}
      {selecting ? null : item.accessory.kind === 'chip' ? (
        <View style={styles.chip}>
          <AppText color="accent" style={styles.label} variant="caption">
            {item.accessory.label}
          </AppText>
        </View>
      ) : (
        <AppText aria-hidden color="textSecondary" style={styles.arrow} variant="caption">
          ›
        </AppText>
      )}
    </Pressable>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[3],
      minHeight: 76,
      paddingVertical: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    containerPressed: {
      backgroundColor: theme.colors.surfacePressed,
    },
    check: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.colors.textTertiary,
    },
    checkSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    checkMark: {
      color: theme.colors.surface,
      fontSize: 13,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: 16,
    },
    dateTile: {
      width: theme.spacing[10],
      alignItems: 'center',
    },
    month: {
      fontSize: 10,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: 13,
    },
    day: {
      fontSize: 19,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: 23,
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      marginBottom: theme.spacing[1],
      fontWeight: theme.typography.fontWeight.semibold,
    },
    chip: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 24,
      paddingVertical: theme.spacing[1],
      paddingHorizontal: 7,
      borderRadius: 6,
      backgroundColor: theme.colors.accentMuted,
    },
    // 목업 16/20은 실기기에서 판독이 어려워 22/26을 쓴다.
    arrow: {
      fontSize: 22,
      lineHeight: 26,
    },
    label: {
      fontSize: 10,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: 13,
    },
  }),
);
