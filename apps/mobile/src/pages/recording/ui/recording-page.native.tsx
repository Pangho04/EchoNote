import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
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
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { useToast } from '@/shared/ui/toast';

import { createRecordingSessionDependencies } from '../model/create-recording-session-dependencies.native';
import { useRecordingExit } from '../model/use-recording-exit';
import { RecordingPageView } from './recording-page-view';

export interface RecordingPageProps {
  meetingId: string;
}

// draft가 없으면 안정 오류 화면을 보여준다. 녹음 중 params가 바뀌어도 처음 받은 회의를 유지한다.
export function RecordingPage({ meetingId }: RecordingPageProps): ReactElement {
  const [initialMeetingId] = useState(meetingId);
  const draft = getRecordingDraft(initialMeetingId);

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
  const { showToast } = useToast();
  const recordingService = useNativeRecordingService();
  const dependencies = useMemo(() => createRecordingSessionDependencies(database), [database]);
  const viewModel = useRecordingSession({
    meetingId: draft.meetingId,
    draftTitle: draft.titleInput,
    recordingService,
    dependencies,
  });
  const { savedRecording, canDiscard, isSaving, discard } = viewModel;
  const { finish, cancel } = useRecordingExit({ canDiscard, isSaving, discard });

  /**
   * @when 녹음 원본 저장이 완료되어 savedRecording이 생겼을 때
   * @expect 저장 완료를 토스트로 알리고 녹음 화면을 떠난다(로그인 상태면 그 회의 상세, 아니면 로그인 화면).
   * @clear -
   */
  useEffect(() => {
    if (!savedRecording) return;

    showToast(UI_STRINGS.recording.saved);
    finish(savedRecording.meetingId);
  }, [finish, savedRecording, showToast]);

  return <RecordingPageView viewModel={viewModel} onCancel={cancel} />;
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
