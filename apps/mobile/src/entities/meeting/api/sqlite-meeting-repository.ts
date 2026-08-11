import type { SQLiteDatabase } from 'expo-sqlite';

import { type Meeting, MeetingStatus } from '../model/meeting';
import type { MeetingRepository } from '../model/meeting-repository';

// SQLite SELECT 결과 한 행의 실제 모양이다.
// 이 type은 adapter 밖으로 export하지 않는다.
type MeetingRow = {
  id: string;
  title: string;
  started_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
};

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: MeetingStatus.LocalOnly,
    // DB의 UTC epoch millisecond를 Domain ISO 문자열로 바꾼다.
    startedAt: new Date(row.started_at_ms).toISOString(),
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
    durationMs: null,
  };
}

export function createSQLiteMeetingRepository(database: SQLiteDatabase): MeetingRepository {
  return {
    async create(params) {
      const startedAtMs = Date.parse(params.startedAt);
      const requestedAtMs = Date.parse(params.requestedAt);

      if (!Number.isFinite(startedAtMs) || !Number.isFinite(requestedAtMs)) {
        throw new RangeError('회의 시각이 올바른 ISO 문자열이 아닙니다.');
      }

      await database.runAsync(
        `INSERT INTO meetings (
          id, title, started_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
        params.meetingId,
        params.title,
        startedAtMs,
        requestedAtMs,
        requestedAtMs,
      );

      const row = await database.getFirstAsync<MeetingRow>(
        `SELECT id, title, started_at_ms, created_at_ms, updated_at_ms
        FROM meetings
        WHERE id = ?`,
        params.meetingId,
      );

      if (!row) {
        throw new Error(`저장한 회의를 찾을 수 없습니다: ${params.meetingId}`);
      }

      return toMeeting(row);
    },

    async list(query) {
      const cursorStartedAtMs = query.cursor?.startedAtMs ?? null;
      const cursorMeetingId = query.cursor?.meetingId ?? null;

      const rows = await database.getAllAsync<MeetingRow>(
        `SELECT id, title, started_at_ms, created_at_ms, updated_at_ms
        FROM meetings
        WHERE started_at_ms >= ?
          AND started_at_ms < ?
          AND (
            ? IS NULL
            OR started_at_ms < ?
            OR (started_at_ms = ? AND id <= ?)
        )
        ORDER BY started_at_ms DESC, id DESC
        LIMIT ?`,
        query.yearStartMs,
        query.nextYearStartMs,
        cursorStartedAtMs,
        cursorStartedAtMs,
        cursorStartedAtMs,
        cursorMeetingId,
        query.limit + 1,
      );

      const pageRows = rows.slice(0, query.limit);
      const lookaheadRow = rows[query.limit];

      return {
        meetings: pageRows.map(toMeeting),
        nextCursor: lookaheadRow
          ? {
              startedAtMs: lookaheadRow.started_at_ms,
              meetingId: lookaheadRow.id,
            }
          : null,
      };
    },
  };
}
