import { FlatList, StyleSheet, View } from 'react-native';

import type { MeetingListItemData } from '@/entities/meeting';
import { MeetingListItem } from '@/entities/meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

const SAMPLE_MEETINGS: MeetingListItemData[] = [
  {
    id: 'sample-meeting-1',
    monthLabel: '8월',
    dayLabel: '04',
    title: '제품 로드맵 정기 회의',
    metaLabel: '52분 · 전사와 요약 완료',
    statusLabel: '완료',
  },
  {
    id: 'sample-meeting-2',
    monthLabel: '9월',
    dayLabel: '21',
    title: '제품 로드맵 후속 회의',
    metaLabel: '1시간 10분 · 전사와 요약 완료',
    statusLabel: '완료',
  },
];

export function MeetingList() {
  const styles = useStyle();

  return (
    <View>
      <AppText color="textSecondary" style={styles.sectionLabel} variant="caption">
        최근 기록
      </AppText>
      <FlatList
        style={styles.list}
        data={SAMPLE_MEETINGS}
        renderItem={({ item }) => <MeetingListItem item={item} />}
        keyExtractor={(item) => item.id}
      />
    </View>
  );
}

const useStyle = createThemedStyles((theme) =>
  StyleSheet.create({
    sectionLabel: {
      marginTop: theme.spacing[6],
      marginHorizontal: 18,
      marginBottom: theme.spacing[2],
      fontWeight: theme.typography.fontWeight.bold,
    },
    list: {
      backgroundColor: theme.colors.surface,
      borderTopColor: theme.colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
  }),
);
