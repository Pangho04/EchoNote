import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

import { MeetingDetailPage } from '@/pages/meeting-detail';

// route는 meetingId가 string인지만 확인해 넘긴다. 빈 값은 상세에서 not-found로 흡수된다.
export default function MeetingDetailRoute(): ReactElement {
  const { meetingId } = useLocalSearchParams<{ meetingId?: string }>();

  return <MeetingDetailPage meetingId={typeof meetingId === 'string' ? meetingId : ''} />;
}
