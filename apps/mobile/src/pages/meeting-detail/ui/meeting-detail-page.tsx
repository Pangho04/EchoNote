import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecordingPlayer } from '@/features/play-recording';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import { createMeetingDetailLoader } from '../model/create-meeting-detail-loader';
import { useMeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
import { MeetingDetailHeader } from './meeting-detail-header';

export interface MeetingDetailPageProps {
  meetingId: string;
}

export function MeetingDetailPage({ meetingId }: MeetingDetailPageProps): ReactElement {
  const database = useSQLiteContext();
  const router = useRouter();
  const styles = useStyles();
  const { openDialog } = useDialog();

  const loadMeetingDetail = useMemo(() => createMeetingDetailLoader(database), [database]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const viewModel = useMeetingDetailViewModel({ meetingId, timeZone, loadMeetingDetail });

  // deep link로 바로 들어오면 되돌아갈 화면이 없다.
  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace(ROUTES.meeting.list);
  }, [router]);

  /**
   * @when 회의를 열 수 없다고 판정됐을 때
   * @expect 이유를 팝업으로 알리고 닫히면 목록으로 되돌린다.
   * @clear -
   */
  useEffect(() => {
    if (viewModel.kind === 'loading' || viewModel.kind === 'ready') return;

    openDialog({
      title: UI_STRINGS.meetingDetail.openFailedTitle,
      message: viewModel.message,
      actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary', onPress: leave }],
      onDismiss: leave,
    });
  }, [leave, openDialog, viewModel]);

  // 컴포넌트가 아니라 함수로 호출한다. 요소 타입이 유지되어야 상태가 보존된다.
  function renderBody(): ReactElement {
    switch (viewModel.kind) {
      case 'ready':
        return (
          <>
            <MeetingDetailHeader
              dateLabel={viewModel.dateLabel}
              metaLabel={viewModel.metaLabel}
              title={viewModel.title}
            />

            <RecordingPlayer uri={viewModel.recordingUri} />
          </>
        );

      // 이 셋은 팝업이 안내를 맡는다. 본문에는 아무것도 그리지 않는다.
      case 'not-found':
      case 'recording-missing':
      case 'error':
      case 'loading':
        return <View style={styles.body} />;
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <NavigationHeader
        title={UI_STRINGS.meetingDetail.heading}
        action={{
          label: UI_STRINGS.meetingDetail.back,
          accessibilityLabel: UI_STRINGS.meetingDetail.backLabel,
          onPress: leave,
        }}
      />

      {renderBody()}
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
    body: {
      flex: 1,
    },
  }),
);
