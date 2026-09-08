import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RecordingSessionViewModel } from '@/features/record-meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingRecorder } from '@/widgets/meeting-recorder';

export interface RecordingPageViewProps {
  viewModel: RecordingSessionViewModel;
}

// 저장된 결과 또는 진행 중인 ViewModel만 표시하는 platform-neutral 뷰다.
export function RecordingPageView({ viewModel }: RecordingPageViewProps): ReactElement {
  const styles = useStyles();

  if (viewModel.savedRecording) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <AppText variant="display" color="textPrimary" accessibilityRole="header">
          녹음 저장 완료
        </AppText>
        <AppText color="textSecondary" variant="body">
          {viewModel.savedRecording.durationMs}ms 녹음이 저장되었습니다.
        </AppText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <MeetingRecorder viewModel={viewModel} />
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
  }),
);
