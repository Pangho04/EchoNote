import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExportMeetingButton } from '@/features/export-meeting-file/ui/export-meeting-button';
import { pendingImports } from '@/features/record-meeting';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';
import { NavigationHeader } from '@/shared/ui/navigation-header';
import { StatusRow } from '@/shared/ui/status-row';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import {
  createMeetingDetailLoader,
  createMeetingTitleCommands,
} from '../model/create-meeting-detail-loader';
import { useMeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
import { MeetingDetailContent } from './meeting-detail-content';
import { MeetingDetailHeader } from './meeting-detail-header';

export interface MeetingDetailPageProps {
  meetingId: string;
  autoRequest: boolean;
}

export function MeetingDetailPage({
  meetingId,
  autoRequest,
}: MeetingDetailPageProps): ReactElement {
  const database = useSQLiteContext();
  const router = useRouter();
  const styles = useStyles();
  const { openDialog } = useDialog();

  const loadMeetingDetail = useMemo(() => createMeetingDetailLoader(database), [database]);
  const titleCommands = useMemo(() => createMeetingTitleCommands(database), [database]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const { viewModel, recording, rename } = useMeetingDetailViewModel({
    meetingId,
    timeZone,
    loadMeetingDetail,
    getPendingImport: pendingImports.get,
    consumePendingImport: pendingImports.consume,
    loadMeeting: titleCommands.loadMeeting,
    renameMeeting: titleCommands.renameMeeting,
  });
  // import-failed는 다시 렌더돼도 유지되므로 목록으로 한 번만 돌아간다.
  const hasLeftAfterImportFailure = useRef(false);

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
    switch (viewModel.kind) {
      case 'loading':
      case 'importing':
      case 'ready':
        return;

      case 'import-failed':
        if (hasLeftAfterImportFailure.current) return;

        hasLeftAfterImportFailure.current = true;
        leave();

        return;

      case 'not-found':
      case 'recording-missing':
      case 'error':
        openDialog({
          title: UI_STRINGS.meetingDetail.openFailedTitle,
          message: viewModel.message,
          actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary', onPress: leave }],
          onDismiss: leave,
        });
    }
  }, [leave, openDialog, viewModel]);

  // 컴포넌트가 아니라 함수로 호출한다. 요소 타입이 유지되어야 상태가 보존된다.
  function renderBody(): ReactElement {
    switch (viewModel.kind) {
      case 'ready':
        if (recording === null) return <View style={styles.body} />;

        return (
          <MeetingDetailContent
            autoRequest={autoRequest}
            recording={recording}
            rename={rename}
            viewModel={viewModel}
          />
        );

      // rename·recordingUri를 넘기지 않아 연필과 내보내기 아이콘이 비활성된다.
      case 'importing':
        return (
          <>
            <MeetingDetailHeader
              dateLabel={viewModel.dateLabel}
              metaAccessory={
                <ExportMeetingButton
                  recordingUri={null}
                  title={viewModel.title}
                  transcript={null}
                />
              }
              metaLabel={UI_STRINGS.meetingDetail.importingMeta}
              title={viewModel.title}
            />

            <View style={styles.importingBody}>
              <StatusRow label={UI_STRINGS.meetingDetail.uploading} />
            </View>
          </>
        );

      // 팝업이나 목록 복귀가 안내를 맡는다. 본문에는 아무것도 그리지 않는다.
      case 'not-found':
      case 'recording-missing':
      case 'error':
      case 'import-failed':
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
    // 텍스트 변환 패널의 상태 행과 같은 자리에 둔다.
    importingBody: {
      paddingHorizontal: theme.spacing[5],
      paddingTop: theme.spacing[6],
    },
  }),
);
