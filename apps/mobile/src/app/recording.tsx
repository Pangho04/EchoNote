import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

import { RecordingPage } from '@/pages/recording';

// route는 유효한 단일 meetingId만 parse해 page로 전달한다. dependency를 조립하지 않는다.
export default function RecordingRoute(): ReactElement {
  const params = useLocalSearchParams<{ meetingId?: string }>();
  const { meetingId } = params;

  if (typeof meetingId !== 'string' || meetingId.length === 0) {
    return <RecordingPage meetingId="" />;
  }

  return <RecordingPage meetingId={meetingId} />;
}
