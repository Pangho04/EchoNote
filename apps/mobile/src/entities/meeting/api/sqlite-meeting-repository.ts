import type { SQLiteDatabase } from 'expo-sqlite';

import { type Meeting, MeetingStatus } from '../model/meeting';
import { MeetingNotFoundError, type MeetingRepository } from '../model/meeting-repository';

// SQLite SELECT 결과 한 행의 실제 모양이다.
// 이 type은 adapter 밖으로 export하지 않는다.
type MeetingRow = {
  id: string;
  title: string;
  created_at_ms: number;
  updated_at_ms: number;
};

function toIsoTimestamp(value: number, field: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field}가 올바른 UTC epoch millisecond가 아닙니다.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${field}가 JavaScript Date 범위를 벗어났습니다.`);
  }

  return date.toISOString();
}

function toEpochMs(value: string, field: string): number {
  const epochMs = Date.parse(value);

  if (!Number.isSafeInteger(epochMs)) {
    throw new RangeError(`${field}가 올바른 ISO 문자열이 아닙니다.`);
  }

  return epochMs;
}

// 목록 조회만 LEFT JOIN으로 마지막 텍스트 변환 status를 함께 읽는다. 행이 없으면 null이다.
type MeetingListRow = MeetingRow & {
  transcription_status: string | null;
};

function toMeetingStatus(value: string | null): MeetingStatus {
  switch (value) {
    case null:
      return MeetingStatus.LocalOnly;
    case 'created':
      return MeetingStatus.Created;
    case 'queued':
      return MeetingStatus.Queued;
    case 'processing':
      return MeetingStatus.Processing;
    case 'completed':
      return MeetingStatus.Completed;
    case 'failed':
      return MeetingStatus.Failed;
    default:
      throw new RangeError(`올바르지 않은 텍스트 변환 status입니다: ${value}`);
  }
}

function toMeeting(row: MeetingRow, status = MeetingStatus.LocalOnly): Meeting {
  return {
    id: row.id,
    title: row.title,
    status,
    createdAt: toIsoTimestamp(row.created_at_ms, 'created_at_ms'),
    updatedAt: toIsoTimestamp(row.updated_at_ms, 'updated_at_ms'),
    durationMs: null,
  };
}

export function createSQLiteMeetingRepository(database: SQLiteDatabase): MeetingRepository {
  return {
    async create(params) {
      const createdAtMs = toEpochMs(params.createdAt, 'createdAt');

      await database.runAsync(
        `INSERT INTO meetings (
          id, title, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
        params.meetingId,
        params.title,
        createdAtMs,
        createdAtMs,
      );

      const row = await database.getFirstAsync<MeetingRow>(
        `SELECT id, title, created_at_ms, updated_at_ms
        FROM meetings
        WHERE id = ?`,
        params.meetingId,
      );

      if (!row) {
        throw new Error(`저장한 회의를 찾을 수 없습니다: ${params.meetingId}`);
      }

      if (row.title !== params.title || row.created_at_ms !== createdAtMs) {
        throw new Error(
          `같은 meetingId에 다른 생성 입력이 이미 저장돼 있습니다: ${params.meetingId}`,
        );
      }

      return toMeeting(row);
    },

    async getByMeetingId(meetingId) {
      const row = await database.getFirstAsync<MeetingRow>(
        `SELECT id, title, created_at_ms, updated_at_ms
        FROM meetings
        WHERE id = ?`,
        meetingId,
      );

      return row ? toMeeting(row) : null;
    },

    async rename(params) {
      const updatedAtMs = toEpochMs(params.updatedAt, 'updatedAt');

      const result = await database.runAsync(
        `UPDATE meetings SET title = ?, updated_at_ms = ? WHERE id = ?`,
        params.title,
        updatedAtMs,
        params.meetingId,
      );

      if (result.changes === 0) {
        throw new MeetingNotFoundError(`회의를 찾을 수 없습니다: ${params.meetingId}`);
      }
    },

    async list(query) {
      const cursorCreatedAtMs = query.cursor?.createdAtMs ?? null;
      const cursorMeetingId = query.cursor?.meetingId ?? null;

      const rows = await database.getAllAsync<MeetingListRow>(
        `SELECT id, title, created_at_ms, updated_at_ms,
          meeting_transcriptions.status AS transcription_status
        FROM meetings
        LEFT JOIN meeting_transcriptions ON meeting_transcriptions.meeting_id = meetings.id
        WHERE created_at_ms >= ?
          AND created_at_ms < ?
          AND (
            ? IS NULL
            OR created_at_ms < ?
            OR (created_at_ms = ? AND id <= ?)
        )
        ORDER BY created_at_ms DESC, id DESC
        LIMIT ?`,
        query.yearStartMs,
        query.nextYearStartMs,
        cursorCreatedAtMs,
        cursorCreatedAtMs,
        cursorCreatedAtMs,
        cursorMeetingId,
        query.limit + 1,
      );

      const pageRows = rows.slice(0, query.limit);
      const lookaheadRow = rows[query.limit];

      return {
        meetings: pageRows.map((row) => toMeeting(row, toMeetingStatus(row.transcription_status))),
        nextCursor: lookaheadRow
          ? {
              createdAtMs: lookaheadRow.created_at_ms,
              meetingId: lookaheadRow.id,
            }
          : null,
      };
    },
  };
}
