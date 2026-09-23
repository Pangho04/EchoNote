import type { SQLiteDatabase } from 'expo-sqlite';

import type { Recording } from '../model/recording';
import type { RecordingRepository } from '../model/recording-repository';
import { toRecordingFileUri } from './recording-file-location';

// recordings Row 한 행의 실제 모양이다. adapter 밖으로 export하지 않는다.
type RecordingRow = {
  meeting_id: string;
  relative_path: string;
  mime_type: string;
  sha256: string;
  duration_ms: number;
  byte_size: number;
};

function toRecording(row: RecordingRow): Recording {
  return {
    meetingId: row.meeting_id,
    uri: toRecordingFileUri(row.relative_path),
    mimeType: row.mime_type,
    sha256: row.sha256,
    durationMs: row.duration_ms,
    byteSize: row.byte_size,
  };
}

export function createSQLiteRecordingRepository(database: SQLiteDatabase): RecordingRepository {
  return {
    async getSavedByMeetingId(meetingId) {
      const row = await database.getFirstAsync<RecordingRow>(
        `SELECT meeting_id, relative_path, mime_type, sha256, duration_ms, byte_size
        FROM recordings
        WHERE meeting_id = ?`,
        meetingId,
      );

      return row ? toRecording(row) : null;
    },
  };
}
