import type { SQLiteDatabase } from 'expo-sqlite';

import { createSQLiteMeetingRepository, type Meeting } from '@/entities/meeting';
import { createSQLiteRecordingRepository, recordingFileExists } from '@/entities/recording';
import { getMeetingDetail, type MeetingDetailResult } from '@/features/get-meeting-detail';
import { renameMeeting } from '@/features/rename-meeting';

export type MeetingDetailLoader = (meetingId: string) => Promise<MeetingDetailResult>;

// 상세 화면에서 SQLite repository를 조회·이름 수정 기능에 주입하는 유일한 지점이다.
// 상세 page·route·ViewModel은 repository를 모른다.
export function createMeetingDetailLoader(database: SQLiteDatabase): MeetingDetailLoader {
  const meetings = createSQLiteMeetingRepository(database);
  const recordings = createSQLiteRecordingRepository(database);

  return (meetingId) => getMeetingDetail({ meetings, recordings, recordingFileExists }, meetingId);
}

export type MeetingTitleCommands = {
  loadMeeting(meetingId: string): Promise<Meeting | null>;
  renameMeeting(meetingId: string, title: string): Promise<void>;
};

export function createMeetingTitleCommands(database: SQLiteDatabase): MeetingTitleCommands {
  const meetings = createSQLiteMeetingRepository(database);

  return {
    loadMeeting: (meetingId) => meetings.getByMeetingId(meetingId),
    renameMeeting: (meetingId, title) =>
      renameMeeting(
        { repository: meetings, now: () => new Date().toISOString() },
        { meetingId, title },
      ),
  };
}
