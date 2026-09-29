import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recordingPermissionService } from '@/features/record-meeting/api/recording-permission-service.native';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { useDialog } from '@/shared/ui/dialog';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingList, MeetingYearFilter, MeetingYearMenu } from '@/widgets/meeting-list';

import { useMeetingLibraryViewModel } from '../model/use-meeting-library-view-model';
import { MeetingEditToolbar } from './meeting-edit-toolbar';
import { RecordingButton } from './recording-button';
import { RecordingTitleForm } from './recording-title-form';

export function MeetingLibraryPage() {
  const router = useRouter();
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
  } = useMeetingLibraryViewModel(recordingPermissionService, () => Crypto.randomUUID());

  const { openDialog, closeDialog } = useDialog();
  const [isYearMenuOpen, setIsYearMenuOpen] = useState(false);

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
    <SafeAreaView
      edges={['top']}
      // 메뉴 바깥을 누르면 닫는다. 필터 안의 터치는 필터가 여기까지 올려 보내지 않는다.
      onTouchStart={isYearMenuOpen ? () => setIsYearMenuOpen(false) : undefined}
      style={styles.safeArea}
    >
      <NavigationHeader
        title={UI_STRINGS.meetingLibrary.heading}
        titleVariant="display"
        trailingAction={
          items.length > 0 || isEditing
            ? {
                label: isEditing ? UI_STRINGS.common.cancel : UI_STRINGS.meetingLibrary.edit,
                accessibilityLabel: isEditing
                  ? UI_STRINGS.meetingLibrary.cancelEditLabel
                  : UI_STRINGS.meetingLibrary.editLabel,
                onPress: () => {
                  setIsYearMenuOpen(false);
                  toggleEditing();
                },
                disabled: isDeleting,
              }
            : undefined
        }
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
              <MeetingYearFilter
                disabled={isEditing || isDeleting}
                isOpen={isYearMenuOpen}
                onToggle={() => setIsYearMenuOpen((open) => !open)}
                selectedYear={selectedYear}
              />
            }
            headingOverlay={
              isYearMenuOpen ? (
                <MeetingYearMenu
                  onSelectYear={(year) => {
                    setIsYearMenuOpen(false);
                    selectYear(year);
                  }}
                  selectedYear={selectedYear}
                  years={yearOptions}
                />
              ) : null
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

        {/* 개발 빌드에서만 보이는 임시 진입점이다. 로그인 화면이 생기면 ROUTES.dev와 함께 지운다. */}
        {__DEV__ && !isEditing && (
          <Pressable
            accessibilityLabel={UI_STRINGS.meetingLibrary.openUiLabLabel}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push(ROUTES.dev.uiLab)}
            style={styles.uiLabButtonPosition}
          >
            <AppText color="accent" variant="body">
              {UI_STRINGS.meetingLibrary.openUiLab}
            </AppText>
          </Pressable>
        )}

        {!isEditing && (
          <View style={styles.recordingButtonPosition}>
            <RecordingButton openTitleDialog={openRecordingTitleDialog} />
          </View>
        )}
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
    uiLabButtonPosition: {
      bottom: theme.spacing[6],
      left: 18,
      position: 'absolute',
    },
  }),
);
