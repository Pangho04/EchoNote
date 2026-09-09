import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
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
    refresh,
    permissionMessage,
    isPermissionBlocked,
    isTitleDialogOpen,
    openRecordingTitleDialog,
    cancelRecordingTitleDialog,
    confirmRecordingTitle,
  } = useMeetingLibraryViewModel(recordingPermissionService, () => Crypto.randomUUID());

  const styles = useStyles();

  /**
   * @when 회의 목록 화면이 포커스를 얻을 때마다(녹음 화면에서 돌아온 직후 포함)
   * @expect 방금 저장한 녹음까지 반영되도록 목록을 다시 읽는다.
   * @clear 진행 중인 조회는 결과를 버리므로 별도 정리가 없다.
   */
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

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
          canOpenSettings={isPermissionBlocked}
          permissionMessage={permissionMessage}
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
