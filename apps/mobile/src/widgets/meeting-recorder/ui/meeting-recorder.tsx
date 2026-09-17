import type { ReactElement } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import type { RecordingSessionViewModel } from '@/features/record-meeting';
import { RecordingControls } from '@/features/record-meeting/ui/recording-controls';
import { RecordingSaveError } from '@/features/record-meeting/ui/recording-save-error';
import { RecordingTitleEditor } from '@/features/record-meeting/ui/recording-title-editor';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingRecorderProps {
  viewModel: RecordingSessionViewModel;
}

export function MeetingRecorder({ viewModel }: MeetingRecorderProps): ReactElement {
  const styles = useStyles();

  if (viewModel.saveStatus === 'failed') {
    return (
      <View style={styles.container}>
        <RecordingSaveError
          message={viewModel.errorMessage ?? UI_STRINGS.recording.saveFailed}
          onRetry={viewModel.retrySave}
        />
      </View>
    );
  }

  return (
    // 제목 입력 키보드가 녹음 컨트롤을 가리므로 빈 곳을 눌러 닫을 수 있게 한다.
    // responder를 가져가지 않으므로(false 반환) 버튼을 누른 경우에는 호출되지 않는다.
    <View
      onStartShouldSetResponder={() => {
        Keyboard.dismiss();

        return false;
      }}
      style={styles.container}
    >
      <View style={styles.titleArea}>
        <RecordingTitleEditor
          editable={viewModel.saveStatus === 'idle' || viewModel.saveStatus === 'saving'}
          onChangeText={viewModel.changeTitle}
          value={viewModel.titleInput}
        />
      </View>

      <View style={styles.controlArea}>
        <AppText
          accessibilityRole="header"
          adjustsFontSizeToFit
          color="textPrimary"
          numberOfLines={1}
          style={styles.elapsed}
          variant="display"
        >
          {viewModel.elapsedLabel}
        </AppText>

        <RecordingControls
          canPause={viewModel.canPause}
          canResume={viewModel.canResume}
          canStop={viewModel.canStop}
          onPause={viewModel.pause}
          onResume={viewModel.resume}
          onStop={viewModel.stop}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[6],
    },
    titleArea: {
      gap: theme.spacing[4],
    },
    elapsed: {
      fontSize: theme.typography.fontSize.timer,
      lineHeight: theme.typography.lineHeight.timer,
      textAlign: 'center',
    },
    controlArea: {
      alignItems: 'center',
      flex: 1,
      gap: theme.spacing[6],
      justifyContent: 'center',
    },
  }),
);
