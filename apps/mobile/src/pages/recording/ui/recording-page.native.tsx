import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { useNativeRecordingService } from '@/features/record-meeting/api/use-recording-service.native';
import {
  getRecordingDraft,
  type RecordingDraft,
} from '@/features/record-meeting/model/recording-draft';
import { useRecordingSession } from '@/features/record-meeting/model/use-recording-session';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

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

// 실제 recorder·우-écnico 서비스를 조합하는 inner screen이다.
function RecordingSessionScreen({ draft }: { draft: RecordingDraft }): ReactElement {
  const database = useSQLiteContext();
  const recordingService = useNativeRecordingService();
  const dependencies = useMemo(() => createRecordingSessionDependencies(database), [database]);
  const viewModel = useRecordingSession({
    meetingId: draft.meetingId,
    draftTitle: draft.titleInput,
    recordingService,
    dependencies,
  });

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
