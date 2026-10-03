import {
  jobFailureCodeSchema,
  processingJobStatusSchema,
  transcriptResultSchema,
} from '@echonote/contracts';
import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

import type {
  StoredTranscription,
  Transcription,
  TranscriptionRepository,
} from '../model/transcription';

type TranscriptionRow = {
  job_id: string;
  status: string;
  error_code: string | null;
  duration_ms: number | null;
  segments_json: string | null;
};

const jobIdSchema = z.uuid();

function toTranscription(row: TranscriptionRow): Transcription | null {
  const status = processingJobStatusSchema.safeParse(row.status);

  if (!status.success || !jobIdSchema.safeParse(row.job_id).success) {
    return null;
  }

  switch (status.data) {
    case 'created':
    case 'queued':
    case 'processing':
      return row.error_code === null ? { status: status.data, jobId: row.job_id } : null;
    case 'failed': {
      if (row.error_code === null) {
        return { status: 'failed', jobId: row.job_id, errorCode: null };
      }

      const errorCode = jobFailureCodeSchema.safeParse(row.error_code);

      return errorCode.success
        ? { status: 'failed', jobId: row.job_id, errorCode: errorCode.data }
        : null;
    }
    case 'completed': {
      if (row.segments_json === null) {
        return null;
      }

      let segments: unknown;

      try {
        segments = JSON.parse(row.segments_json);
      } catch {
        return null;
      }

      const content = transcriptResultSchema.safeParse({ durationMs: row.duration_ms, segments });

      return content.success
        ? { status: 'completed', jobId: row.job_id, content: content.data }
        : null;
    }
  }
}

export function createSQLiteTranscriptionRepository(
  database: SQLiteDatabase,
): TranscriptionRepository {
  return {
    async get(meetingId): Promise<StoredTranscription> {
      const row = await database.getFirstAsync<TranscriptionRow>(
        `SELECT job_id, status, error_code, duration_ms, segments_json
        FROM meeting_transcriptions
        WHERE meeting_id = ?`,
        meetingId,
      );

      if (!row) {
        return { kind: 'none' };
      }

      const transcription = toTranscription(row);

      return transcription
        ? { kind: 'row', transcription }
        : { kind: 'corrupt', status: row.status, jobId: row.job_id };
    },

    async upsertCreated(meetingId, jobId) {
      // completed 전사는 새 시도로 덮어쓰지 않는다.
      const result = await database.runAsync(
        `INSERT INTO meeting_transcriptions (meeting_id, job_id, status)
        VALUES (?, ?, 'created')
        ON CONFLICT(meeting_id) DO UPDATE SET
          job_id = excluded.job_id,
          status = 'created',
          error_code = NULL,
          duration_ms = NULL,
          segments_json = NULL
        WHERE meeting_transcriptions.status <> 'completed'`,
        meetingId,
        jobId,
      );

      return result.changes > 0;
    },

    async updateStatus(meetingId, jobId, status, errorCode) {
      // 같은 job을 두 화면이 볼 때 늦은 응답이 완료 행을 내리지 못하게 한다.
      const result = await database.runAsync(
        `UPDATE meeting_transcriptions
        SET status = ?, error_code = CASE WHEN ? = 'failed' THEN ? ELSE NULL END
        WHERE meeting_id = ? AND job_id = ? AND status <> 'completed'`,
        status,
        status,
        errorCode,
        meetingId,
        jobId,
      );

      return result.changes > 0;
    },

    async saveCompleted(meetingId, jobId, content) {
      // 손상된 completed 행도 다시 받은 전사로 덮어써야 해서 status 조건을 두지 않는다.
      const result = await database.runAsync(
        `UPDATE meeting_transcriptions
        SET status = 'completed', error_code = NULL, duration_ms = ?, segments_json = ?
        WHERE meeting_id = ? AND job_id = ?`,
        content.durationMs,
        JSON.stringify(content.segments),
        meetingId,
        jobId,
      );

      return result.changes > 0;
    },

    async delete(meetingId, jobId) {
      const result = await database.runAsync(
        `DELETE FROM meeting_transcriptions
        WHERE meeting_id = ? AND job_id = ? AND status <> 'completed'`,
        meetingId,
        jobId,
      );

      return result.changes > 0;
    },

    async deleteCorrupt(meetingId, jobId) {
      const result = await database.runAsync(
        `DELETE FROM meeting_transcriptions
        WHERE meeting_id = ? AND job_id = ?`,
        meetingId,
        jobId,
      );

      return result.changes > 0;
    },
  };
}
