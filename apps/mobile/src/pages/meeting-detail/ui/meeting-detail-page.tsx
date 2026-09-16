import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ROUTES } from '@/shared/config/routes';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import { createMeetingDetailLoader } from '../model/create-meeting-detail-loader';
import { useMeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
import { MeetingDetailHeader } from './meeting-detail-header';
import { MeetingDetailMissing } from './meeting-detail-missing';
import { MeetingDetailNavigation } from './meeting-detail-navigation';

export interface MeetingDetailPageProps {
  meetingId: string;
}

export function MeetingDetailPage({ meetingId }: MeetingDetailPageProps): ReactElement {
  const database = useSQLiteContext();
  const router = useRouter();
  const styles = useStyles();

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

  // 컴포넌트가 아니라 함수로 호출한다. 요소 타입이 유지되어야 상태가 보존된다.
  function renderBody(): ReactElement {
    switch (viewModel.kind) {
      case 'ready':
        return (
          <MeetingDetailHeader
            dateLabel={viewModel.dateLabel}
            metaLabel={viewModel.metaLabel}
            title={viewModel.title}
          />
        );

      case 'not-found':
      case 'error':
        return <MeetingDetailMissing message={viewModel.message} onLeave={leave} />;

      case 'loading':
        return <View style={styles.body} />;
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <MeetingDetailNavigation onBack={leave} />

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
