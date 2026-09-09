import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { useNativeRecordingService } from '@/features/record-meeting/api/use-recording-service.native';
import {
  getRecordingDraft,
  type RecordingDraft,
} from '@/features/record-meeting/model/recording-draft';
import { useRecordingSession } from '@/features/record-meeting/model/use-recording-session';
import { AppText } from '@/shared/ui/app-text';
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
  const styles = useStyles();

  return (
    <AppText color="textSecondary" style={styles.message} variant="body" accessibilityRole="text">
      녹음을 시작할 수 없습니다.
    </AppText>
  );
}

// 실제 recorder·저장 서비스를 조합하는 inner screen이다.
function RecordingSessionScreen({ draft }: { draft: RecordingDraft }): ReactElement {
  const database = useSQLiteContext();
  const router = useRouter();
  const { showToast } = useToast();
  const recordingService = useNativeRecordingService();
  const dependencies = useMemo(() => createRecordingSessionDependencies(database), [database]);
  const viewModel = useRecordingSession({
    meetingId: draft.meetingId,
    draftTitle: draft.titleInput,
    recordingService,
    dependencies,
  });
  const { savedRecording } = viewModel;

  /**
   * @when 녹음 원본 저장이 완료되어 savedRecording이 생겼을 때
   * @expect 저장 완료를 토스트로 알리고 회의 목록 화면으로 되돌아간다.
   * @clear 화면이 stack에서 빠지므로 별도 정리가 없다.
   */
  useEffect(() => {
    if (!savedRecording) return;

    showToast('녹음을 저장했습니다.');
    router.dismissTo('/');
  }, [router, savedRecording, showToast]);

  return <RecordingPageView viewModel={viewModel} />;
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    message: {
      flex: 1,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[6],
    },
  }),
);
