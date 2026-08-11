import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CreateMeetingButton } from '@/features/create-meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList } from '@/widgets/meeting-list';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';

export function MeetingLibraryPage() {
  const { create, errorMessage, items } = useMeetingLibraryViewModel();

  const styles = useStyles();

  if (errorMessage) {
    console.error(errorMessage);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <AppText variant="display" color="textPrimary" accessibilityRole="header">
          회의
        </AppText>
      </View>

      <View style={styles.content}>
        <View style={styles.meetingListArea}>
          <MeetingList items={items} />
        </View>

        <View style={styles.createMeetingButtonPosition}>
          <CreateMeetingButton createRecord={create} />
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
