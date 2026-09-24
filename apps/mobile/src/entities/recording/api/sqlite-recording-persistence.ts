import type { SQLiteDatabase } from 'expo-sqlite';

import { toRecordingFileUri, toRecordingRelativePath } from './recording-file-location';
import type {
  MeetingRecordingPersistence,
  SaveMeetingWithRecordingParams,
} from './recording-persistence';

function toEpochMs(value: string, field: string): number {
  const epochMs = Date.parse(value);

  if (!Number.isSafeInteger(epochMs)) {
    throw new RangeError(`${field}가 올바른 ISO 문자열이 아닙니다.`);
  }

  return epochMs;
}

export function createSQLiteRecordingPersistence(
  database: SQLiteDatabase,
): MeetingRecordingPersistence {
  return {
    async saveMeetingWithRecording(params: SaveMeetingWithRecordingParams) {
      const createdAtMs = toEpochMs(params.meeting.createdAt, 'createdAt');

      // Meeting과 Recording을 한 transaction으로 묶어 부분 저장을 막는다.
      // 같은 meeting_id가 이미 존재하면 삽입이 실패해 전체가 롤백된다(orphan 0).
      await database.withTransactionAsync(async () => {
        await database.runAsync(
          `INSERT INTO meetings (
            id, title, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?)`,
          params.meeting.meetingId,
          params.meeting.title,
          createdAtMs,
          createdAtMs,
        );

        await database.runAsync(
          `INSERT INTO recordings (
            meeting_id, relative_path, mime_type, sha256, duration_ms, byte_size
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          params.recording.meetingId,
          toRecordingRelativePath(params.recording.uri),
          params.recording.mimeType,
          params.recording.sha256,
          params.recording.durationMs,
          params.recording.byteSize,
        );
      });
    },

    async deleteMeetingsWithRecordings(meetingIds: string[]) {
      if (meetingIds.length === 0) return [];

      const placeholders = meetingIds.map(() => '?').join(', ');
      let relativePaths: string[] = [];

      // 경로 조회와 삭제를 한 transaction으로 묶어 그사이 바뀐 행을 놓치지 않는다.
      // recordings 행은 ON DELETE CASCADE로 함께 지워진다.
      await database.withTransactionAsync(async () => {
        const rows = await database.getAllAsync<{ relative_path: string }>(
          `SELECT relative_path FROM recordings WHERE meeting_id IN (${placeholders})`,
          ...meetingIds,
        );

        relativePaths = rows.map((row) => row.relative_path);

        await database.runAsync(
          `DELETE FROM meetings WHERE id IN (${placeholders})`,
          ...meetingIds,
        );
      });

      return relativePaths.map(toRecordingFileUri);
    },
  };
}
