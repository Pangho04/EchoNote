import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recordingPermissionService } from '@/features/record-meeting/api/recording-permission-service.native';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList } from '@/widgets/meeting-list';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';
import { RecordingButton } from './recording-button';
import { RecordingTitleDialog } from './recording-title-dialog';

export function MeetingLibraryPage() {
  const router = useRouter();
  const {
    items,
    blockedMessage,
    isTitleDialogOpen,
    openRecordingTitleDialog,
    cancelRecordingTitleDialog,
    confirmRecordingTitle,
  } = useMeetingLibraryViewModel(recordingPermissionService, () => Crypto.randomUUID());

  const styles = useStyles();

  async function handleConfirmTitle(title: string) {
    const result = await confirmRecordingTitle(title);

    if (result.kind === 'granted') {
      router.push(`/recording?meetingId=${result.meetingId}`);
    }
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

        <View style={styles.recordingButtonPosition}>
          <RecordingButton openTitleDialog={openRecordingTitleDialog} />
        </View>
      </View>

      {isTitleDialogOpen ? (
        <RecordingTitleDialog
          blockedMessage={blockedMessage}
          onCancel={cancelRecordingTitleDialog}
          onConfirm={handleConfirmTitle}
          onOpenSettings={() => {
            void recordingPermissionService.openSettings();
          }}
        />
      ) : null}
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
    recordingButtonPosition: {
      bottom: theme.spacing[6],
      position: 'absolute',
      right: 18,
    },
  }),
);
