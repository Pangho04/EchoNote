import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Meeting } from '@/entities/meeting';
import { MeetingStatus, toMeetingListItemVM } from '@/entities/meeting';
import { CreateMeetingButton } from '@/features/create-meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList } from '@/widgets/meeting-list';

const SAMPLE_MEETINGS: Meeting[] = [
  {
    id: 'sample-meeting-1',
    title: '제품 로드맵 정기 회의',
    status: MeetingStatus.Completed,
    startedAt: '2026-08-04T09:00:00+09:00',
    createdAt: '2026-08-04T09:00:00+09:00',
    updatedAt: '2026-08-04T09:52:00+09:00',
    durationMs: 52 * 60 * 1000,
  },
  {
    id: 'sample-meeting-2',
    title: '제품 로드맵 후속 회의',
    status: MeetingStatus.Completed,
    startedAt: '2026-09-21T14:00:00+09:00',
    createdAt: '2026-09-21T14:00:00+09:00',
    updatedAt: '2026-09-21T15:10:00+09:00',
    durationMs: 70 * 60 * 1000,
  },
];

const SAMPLE_MEETING_LIST_ITEMS = SAMPLE_MEETINGS.map(toMeetingListItemVM);

export function MeetingLibraryPage() {
  const styles = useStyles();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <AppText variant="display" color="textPrimary" accessibilityRole="header">
          회의
        </AppText>
      </View>

      <View style={styles.content}>
        <View style={styles.meetingListArea}>
          <MeetingList items={SAMPLE_MEETING_LIST_ITEMS} />
        </View>

        <View style={styles.createMeetingButtonPosition}>
          <CreateMeetingButton />
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
    header: {
      backgroundColor: theme.colors.surface,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      justifyContent: 'flex-end',
      minHeight: 64,
      paddingBottom: 9,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    content: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
    meetingListArea: {
      flex: 1,
      marginBottom: 100,
    },
    createMeetingButtonPosition: {
      bottom: theme.spacing[6],
      position: 'absolute',
      right: 18,
    },
  }),
);
