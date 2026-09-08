import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createSQLiteRecordingPersistence,
  createSQLiteRecordingRepository,
  type Recording,
} from '@/entities/recording';
import {
  createFinalRecordingUri,
  createNativeRecordingFileService,
} from '@/features/record-meeting/api/recording-file-service.native';
import {
  isAllowedRecordingMimeType,
  saveRecording,
} from '@/features/record-meeting/model/save-recording';
import type { RecordingSessionDependencies } from '@/features/record-meeting/model/use-recording-session';

// clock·time zone·G1-4 save dependency를 조립하는 factory다.
// 화면은 이 결과를 useMemo로 고정한다. hook은 factory 밖에 둔다.
export function createRecordingSessionDependencies(
  database: SQLiteDatabase,
): RecordingSessionDependencies {
  const persistence = createSQLiteRecordingPersistence(database);
  const recordings = createSQLiteRecordingRepository(database);
  const files = createNativeRecordingFileService();

  return {
    now: () => new Date().toISOString(),
    getCurrentTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    saveRecording: (input) =>
      saveRecording(
        {
          persistence,
          files,
          createFinalUri: createFinalRecordingUri,
          isAllowedMimeType: isAllowedRecordingMimeType,
        },
        input,
      ),
    getSavedByMeetingId: async (meetingId: string): Promise<Recording | null> =>
      recordings.getSavedByMeetingId(meetingId),
  };
}
