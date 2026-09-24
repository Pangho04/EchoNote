import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RecordingSessionViewModel } from '@/features/record-meeting';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';
import { MeetingRecorder } from '@/widgets/meeting-recorder';

export interface RecordingPageViewProps {
  viewModel: RecordingSessionViewModel;
  onCancel: () => void;
}

// 진행 중인 ViewModel만 표시한다. 저장 완료 후 화면 전환은 page가 담당한다.
export function RecordingPageView({ viewModel, onCancel }: RecordingPageViewProps): ReactElement {
  const styles = useStyles();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <NavigationHeader
        title={UI_STRINGS.recording.heading}
        action={{
          label: UI_STRINGS.common.cancel,
          accessibilityLabel: UI_STRINGS.recording.cancelLabel,
          onPress: onCancel,
        }}
      />

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
