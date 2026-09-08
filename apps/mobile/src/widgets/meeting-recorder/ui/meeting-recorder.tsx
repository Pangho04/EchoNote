import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RecordingSessionViewModel } from '@/features/record-meeting';
import { RecordingControls } from '@/features/record-meeting/ui/recording-controls';
import { RecordingSaveError } from '@/features/record-meeting/ui/recording-save-error';
import { RecordingTitleEditor } from '@/features/record-meeting/ui/recording-title-editor';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingRecorderProps {
  viewModel: RecordingSessionViewModel;
}

export function MeetingRecorder({ viewModel }: MeetingRecorderProps): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" variant="body" accessibilityRole="header">
        {viewModel.elapsedLabel}
      </AppText>

      <RecordingTitleEditor
        editable={viewModel.saveStatus === 'idle' || viewModel.saveStatus === 'saving'}
        onChangeText={viewModel.changeTitle}
        value={viewModel.titleInput}
      />

      {viewModel.saveStatus === 'failed' ? (
        <RecordingSaveError
          message={viewModel.errorMessage ?? '저장하지 못했습니다.'}
          onRetry={viewModel.retrySave}
        />
      ) : (
        <RecordingControls
          canPause={viewModel.canPause}
          canResume={viewModel.canResume}
          canStop={viewModel.canStop}
          onPause={viewModel.pause}
          onResume={viewModel.resume}
          onStop={viewModel.stop}
        />
      )}
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[6],
      justifyContent: 'space-between',
    },
  }),
);
