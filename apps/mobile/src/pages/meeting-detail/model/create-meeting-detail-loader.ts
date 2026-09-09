import type { SQLiteDatabase } from 'expo-sqlite';

import { createSQLiteMeetingRepository } from '@/entities/meeting';
import { createSQLiteRecordingRepository } from '@/entities/recording';
import { getMeetingDetail, type MeetingDetailResult } from '@/features/get-meeting-detail';

export type MeetingDetailLoader = (meetingId: string) => Promise<MeetingDetailResult>;

// 상세 화면에서 SQLite repository를 use case에 주입하는 유일한 지점이다.
// 상세 page·route·ViewModel은 repository를 모른다.
export function createMeetingDetailLoader(database: SQLiteDatabase): MeetingDetailLoader {
  const meetings = createSQLiteMeetingRepository(database);
  const recordings = createSQLiteRecordingRepository(database);

  return (meetingId) => getMeetingDetail({ meetings, recordings }, meetingId);
}
