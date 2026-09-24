import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNativeRecordingService } from '@/features/record-meeting/api/use-recording-service.native';
import {
  getRecordingDraft,
  type RecordingDraft,
} from '@/features/record-meeting/model/recording-draft';
import { useRecordingSession } from '@/features/record-meeting/model/use-recording-session';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { useDialog } from '@/shared/ui/dialog';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { useToast } from '@/shared/ui/toast';

import { createRecordingSessionDependencies } from '../model/create-recording-session-dependencies.native';
import { RecordingPageView } from './recording-page-view';

export interface RecordingPageProps {
  meetingId: string;
}

// draft가 없으면 안정 오류 화면을 보여준다.
export function RecordingPage({ meetingId }: RecordingPageProps): ReactElement {
  const draft = getRecordingDraft(meetingId);

  if (!draft) {
    return <MissingDraftView />;
  }

  return <RecordingSessionScreen draft={draft} />;
}

function MissingDraftView(): ReactElement {
  const router = useRouter();
  const styles = useStyles();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <NavigationHeader
        title={UI_STRINGS.recording.heading}
        action={{
          label: UI_STRINGS.common.cancel,
          accessibilityLabel: UI_STRINGS.recording.cancelLabel,
          onPress: () => router.dismissTo(ROUTES.meeting.list),
        }}
      />

      <AppText color="textSecondary" style={styles.message} variant="body" accessibilityRole="text">
        {UI_STRINGS.recording.missingDraft}
      </AppText>
    </SafeAreaView>
  );
}

// 실제 recorder·저장 서비스를 조합하는 inner screen이다.
function RecordingSessionScreen({ draft }: { draft: RecordingDraft }): ReactElement {
  const database = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const { showToast } = useToast();
  const { openDialog } = useDialog();
  const recordingService = useNativeRecordingService();
  const dependencies = useMemo(() => createRecordingSessionDependencies(database), [database]);
  const viewModel = useRecordingSession({
    meetingId: draft.meetingId,
    draftTitle: draft.titleInput,
    recordingService,
    dependencies,
  });
  const { savedRecording, canDiscard, isSaving, discard } = viewModel;

  // 취소 버튼·iOS 스와이프·Android 뒤로가기가 모두 여기서 멈춘다. 확인 뒤 같은 action을
  // 다시 보내면 이 hook은 그 action을 다시 막지 않는다.
  usePreventRemove(canDiscard || isSaving, ({ data }) => {
    if (isSaving) return;

    const discardAndLeave = async () => {
      try {
        await discard();
        navigation.dispatch(data.action);
      } catch {
        openDialog({
          message: UI_STRINGS.recording.discardFailed,
          actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
        });
      }
    };

    openDialog({
      title: UI_STRINGS.recording.discardTitle,
      message: UI_STRINGS.recording.discardMessage,
      actions: [
        { label: UI_STRINGS.recording.keepRecording },
        {
          label: UI_STRINGS.recording.discard,
          emphasis: 'destructive',
          onPress: () => void discardAndLeave(),
        },
      ],
    });
  });

  /**
   * @when 녹음 원본 저장이 완료되어 savedRecording이 생겼을 때
   * @expect 저장 완료를 토스트로 알리고 회의 목록 화면으로 되돌아간다.
   * @clear -
   */
  useEffect(() => {
    if (!savedRecording) return;

    showToast(UI_STRINGS.recording.saved);
    router.dismissTo(ROUTES.meeting.list);
  }, [router, savedRecording, showToast]);

  return (
    <RecordingPageView
      viewModel={viewModel}
      onCancel={() => router.dismissTo(ROUTES.meeting.list)}
    />
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
    message: {
      flex: 1,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[6],
    },
  }),
);
