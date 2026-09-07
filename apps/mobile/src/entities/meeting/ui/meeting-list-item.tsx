import { StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import type { MeetingListVMItem } from '../model/meeting';

type Props = {
  item: MeetingListVMItem;
};

export function MeetingListItem({ item }: Props) {
  const styles = useStyles();

  return (
    <View style={styles.container}>
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

      {/** 상태 */}
      <View style={styles.chip}>
        <AppText color="accent" style={styles.label} variant="caption">
          {item.statusLabel}
        </AppText>
      </View>
    </View>
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
    label: {
      fontSize: 10,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: 13,
    },
  }),
);
