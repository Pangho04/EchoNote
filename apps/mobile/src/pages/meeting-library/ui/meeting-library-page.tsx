import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recordingPermissionService } from '@/features/record-meeting/api/recording-permission-service.native';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { useDialog } from '@/shared/ui/dialog';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList } from '@/widgets/meeting-list';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';
import { RecordingButton } from './recording-button';
import { RecordingTitleForm } from './recording-title-form';

export function MeetingLibraryPage() {
  const router = useRouter();
  const { items, refresh, errorMessage, clearErrorMessage, confirmRecordingTitle } =
    useMeetingLibraryViewModel(recordingPermissionService, () => Crypto.randomUUID());

  const { openDialog, closeDialog } = useDialog();

  const styles = useStyles();

  /**
   * @when 회의 목록 화면이 포커스를 얻을 때마다(녹음 화면에서 돌아온 직후 포함)
   * @expect 방금 저장한 녹음까지 반영되도록 목록을 다시 읽는다.
   * @clear -
   */
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /**
   * @when 목록 조회가 실패해 안내할 문구가 생겼을 때
   * @expect 이유를 팝업으로 알리고 다시 시도할 기회를 준다.
   * @clear -
   */
  useEffect(() => {
    if (!errorMessage) return;

    openDialog({
      title: UI_STRINGS.meetingLibrary.loadFailedTitle,
      message: errorMessage,
      actions: [
        { label: UI_STRINGS.common.confirm, onPress: clearErrorMessage },
        {
          label: UI_STRINGS.common.retry,
          emphasis: 'primary',
          onPress: () => {
            clearErrorMessage();
            void refresh();
          },
        },
      ],
      onDismiss: clearErrorMessage,
    });
  }, [clearErrorMessage, errorMessage, openDialog, refresh]);

  function openRecordingTitleDialog() {
    openDialog({
      title: UI_STRINGS.meetingLibrary.newRecording,
      avoidKeyboard: true,
      // 제목을 입력하던 중 바깥을 눌러 팝업이 사라지지 않게 한다.
      dismissible: false,
      content: (
        <RecordingTitleForm
          confirmRecordingTitle={confirmRecordingTitle}
          onCancel={closeDialog}
          onGranted={(meetingId) => {
            closeDialog();
            router.push(ROUTES.recording.session(meetingId));
          }}
          onOpenSettings={() => {
            // 설정에서 권한을 바꾸고 돌아와도 이 팝업에는 권한을 다시 확인할 버튼이 없다.
            // 팝업을 닫아 녹음 버튼부터 다시 시작하게 한다.
            closeDialog();
            void recordingPermissionService.openSettings();
          }}
        />
      ),
    });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <AppText variant="display" color="textPrimary" accessibilityRole="header">
          {UI_STRINGS.meetingLibrary.heading}
        </AppText>
      </View>

      <View style={styles.content}>
        <View style={styles.meetingListArea}>
          <MeetingList
            items={items}
            onMeetingPress={(meetingId) => router.push(ROUTES.meeting.detail(meetingId))}
          />
        </View>

        <View style={styles.recordingButtonPosition}>
          <RecordingButton openTitleDialog={openRecordingTitleDialog} />
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
    recordingButtonPosition: {
      bottom: theme.spacing[6],
      position: 'absolute',
      right: 18,
    },
  }),
);
