import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

import { MeetingDetailPage } from '@/pages/meeting-detail';

// route는 유효한 단일 meetingId만 parse해 page로 넘긴다. 빈 값은 상세에서 not-found로 흡수된다.
export default function MeetingDetailRoute(): ReactElement {
  const { meetingId } = useLocalSearchParams<{ meetingId?: string }>();
  const parsed = typeof meetingId === 'string' ? meetingId : '';

  return <MeetingDetailPage meetingId={parsed} />;
}
