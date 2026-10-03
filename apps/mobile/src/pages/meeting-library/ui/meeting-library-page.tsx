import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createNativeRecordingImportService } from '@/features/record-meeting/api/recording-import-service.native';
import { recordingPermissionService } from '@/features/record-meeting/api/recording-permission-service.native';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { useDialog } from '@/shared/ui/dialog';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList, MeetingYearFilter } from '@/widgets/meeting-list';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';
import { CreateMeetingFab } from './create-meeting-fab';
import { MeetingEditToolbar } from './meeting-edit-toolbar';
import { RecordingTitleForm } from './recording-title-form';

const recordingImportService = createNativeRecordingImportService();

export function MeetingLibraryPage() {
  const router = useRouter();
  const [isFocused, setIsFocused] = useState(false);
  const {
    items,
    isEmpty,
    selectedYear,
    yearOptions,
    selectYear,
    refresh,
    loadMore,
    errorMessage,
    clearErrorMessage,
    confirmRecordingTitle,
    isEditing,
    selectedIds,
    isDeleting,
    toggleEditing,
    toggleSelection,
    deleteMeetings,
    signOut,
    isImporting,
    pickAndImport,
    importFailure,
    dismissImportFailure,
  } = useMeetingLibraryViewModel(
    recordingPermissionService,
    () => Crypto.randomUUID(),
    recordingImportService,
    isFocused,
  );

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
   * @when 목록 화면이 포커스를 얻거나 잃을 때
   * @expect 가져오기 실패 알림을 포커스 중에만 띄우도록 포커스 여부를 기록한다.
   * @clear 포커스를 잃으면 false로 되돌린다.
   */
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);

      return () => setIsFocused(false);
    }, []),
  );

  /**
   * @when 편집 중인 목록 화면에서 Android 뒤로 가기를 눌렀을 때
   * @expect 화면을 떠나지 않고 편집만 끝낸다.
   * @clear 화면을 벗어나거나 편집이 끝나면 뒤로 가기 가로채기를 해제한다.
   */
  useFocusEffect(
    useCallback(() => {
      if (!isEditing) return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        toggleEditing();

        return true;
      });

      return () => subscription.remove();
    }, [isEditing, toggleEditing]),
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

  const importFailureId = importFailure?.meetingId;
  const importFailureMessage = importFailure?.message;

  /**
   * @when 포커스 중인 목록에 알리지 않은 가져오기 실패가 있을 때
   * @expect 회의 제목과 사유를 팝업으로 알리고, 닫으면 다음 실패로 넘어간다.
   * @clear -
   */
  useEffect(() => {
    if (importFailureId === undefined) return;

    openDialog({
      title: UI_STRINGS.meetingLibrary.uploadFailedTitle,
      message: importFailureMessage,
      actions: [
        {
          label: UI_STRINGS.common.confirm,
          onPress: () => dismissImportFailure(importFailureId),
        },
      ],
      onDismiss: () => dismissImportFailure(importFailureId),
    });
  }, [dismissImportFailure, importFailureId, importFailureMessage, openDialog]);

  function openUploadFailedDialog(message: string) {
    openDialog({
      title: UI_STRINGS.meetingLibrary.uploadFailedTitle,
      message,
      actions: [{ label: UI_STRINGS.common.confirm }],
    });
  }

  async function uploadRecording() {
    const result = await pickAndImport();

    switch (result.kind) {
      case 'started':
        router.push(ROUTES.meeting.afterRecording(result.meetingId));
        return;
      case 'canceled':
        return;
      case 'tooLarge':
        openUploadFailedDialog(UI_STRINGS.meetingLibrary.uploadTooLarge);
        return;
      case 'failed':
        openUploadFailedDialog(UI_STRINGS.meetingLibrary.uploadFailed);
        return;
    }
  }

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

  function openSignOutDialog() {
    openDialog({
      title: UI_STRINGS.auth.signOutTitle,
      actions: [
        { label: UI_STRINGS.common.cancel },
        {
          label: UI_STRINGS.auth.signOut,
          emphasis: 'destructive',
          onPress: () => {
            void signOut();
          },
        },
      ],
    });
  }

  function openDeleteDialog(meetingIds: string[]) {
    openDialog({
      title: UI_STRINGS.meetingLibrary.deleteTitle,
      message: UI_STRINGS.meetingLibrary.deleteMessage,
      actions: [
        { label: UI_STRINGS.common.cancel },
        {
          label: UI_STRINGS.common.confirm,
          emphasis: 'destructive',
          onPress: async () => {
            if (await deleteMeetings(meetingIds)) return;

            openDialog({
              title: UI_STRINGS.meetingLibrary.deleteTitle,
              message: UI_STRINGS.meetingLibrary.deleteFailed,
              actions: [{ label: UI_STRINGS.common.confirm }],
            });
          },
        },
      ],
    });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <NavigationHeader
        title={UI_STRINGS.meetingLibrary.heading}
        titleVariant="display"
        trailingAction={{
          label: UI_STRINGS.auth.signOut,
          accessibilityLabel: UI_STRINGS.auth.signOut,
          onPress: openSignOutDialog,
          disabled: isDeleting,
        }}
      />

      <View style={styles.content}>
        <View style={styles.meetingListArea}>
          <MeetingList
            items={items}
            emptyMessage={isEmpty ? UI_STRINGS.meetingLibrary.empty : undefined}
            onEndReached={() => void loadMore()}
            onMeetingPress={(meetingId) => router.push(ROUTES.meeting.detail(meetingId))}
            onMeetingDelete={isDeleting ? undefined : (meetingId) => openDeleteDialog([meetingId])}
            onToggleSelection={isDeleting ? undefined : toggleSelection}
            headingAccessory={
              <View style={styles.headingAccessory}>
                <MeetingYearFilter
                  disabled={isEditing || isDeleting}
                  onSelectYear={selectYear}
                  selectedYear={selectedYear}
                  years={yearOptions}
                />

                {(items.length > 0 || isEditing) && (
                  <Pressable
                    accessibilityLabel={
                      isEditing
                        ? UI_STRINGS.meetingLibrary.cancelSelectLabel
                        : UI_STRINGS.meetingLibrary.selectLabel
                    }
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isDeleting }}
                    disabled={isDeleting}
                    hitSlop={5}
                    onPress={toggleEditing}
                    style={styles.selectButton}
                  >
                    <AppText
                      color={isDeleting ? 'textTertiary' : 'accent'}
                      style={styles.selectButtonLabel}
                      variant="body"
                    >
                      {isEditing ? UI_STRINGS.common.cancel : UI_STRINGS.meetingLibrary.select}
                    </AppText>
                  </Pressable>
                )}
              </View>
            }
            selectedIds={isEditing ? selectedIds : undefined}
            toolbar={
              isEditing ? (
                <MeetingEditToolbar
                  disabled={isDeleting}
                  onDeletePress={() => openDeleteDialog([...selectedIds])}
                  selectedCount={selectedIds.size}
                />
              ) : null
            }
          />
        </View>
      </View>

      {!isEditing && (
        <CreateMeetingFab
          disabled={isImporting}
          onRecord={openRecordingTitleDialog}
          onUpload={() => void uploadRecording()}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
    content: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
    meetingListArea: {
      flex: 1,
      marginBottom: 100,
    },
    headingAccessory: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[1],
    },
    selectButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 44,
    },
    selectButtonLabel: {
      fontWeight: theme.typography.fontWeight.bold,
    },
  }),
);
