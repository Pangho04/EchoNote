import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { MeetingStatus } from '../model/meeting';
import { createSQLiteMeetingRepository } from './sqlite-meeting-repository';

type DatabaseDouble = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync'>;

function makeDatabaseDouble(): DatabaseDouble {
  return {
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    runAsync: vi.fn(),
  } as unknown as DatabaseDouble;
}

function asSQLiteDatabase(database: DatabaseDouble): SQLiteDatabase {
  return database as SQLiteDatabase;
}

describe('createSQLiteMeetingRepository', () => {
  it('create는 같은 Params를 다시 받아도 같은 id를 bind하고 저장된 Row를 Domain으로 변환한다', async () => {
    const database = makeDatabaseDouble();
    const startedAt = '2026-08-08T00:10:00.000Z';
    const requestedAt = '2026-08-08T00:11:00.000Z';
    const startedAtMs = Date.parse(startedAt);
    const requestedAtMs = Date.parse(requestedAt);

    vi.mocked(database.runAsync).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    vi.mocked(database.getFirstAsync).mockResolvedValue({
      id: 'meeting-1',
      title: '제품 회의',
      started_at_ms: startedAtMs,
      created_at_ms: requestedAtMs,
      updated_at_ms: requestedAtMs,
    });

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));
    const params = {
      meetingId: 'meeting-1',
      title: '제품 회의',
      startedAt,
      requestedAt,
    };
    const firstResult = await repository.create(params);
    const secondResult = await repository.create(params);

    expect(database.runAsync).toHaveBeenCalledTimes(2);
    expect(database.runAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('ON CONFLICT(id) DO NOTHING'),
      'meeting-1',
      '제품 회의',
      startedAtMs,
      requestedAtMs,
      requestedAtMs,
    );
    expect(database.getFirstAsync).toHaveBeenCalledTimes(2);
    expect(database.getFirstAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE id = ?'),
      'meeting-1',
    );
    expect(firstResult).toEqual({
      id: 'meeting-1',
      title: '제품 회의',
      status: MeetingStatus.LocalOnly,
      startedAt,
      createdAt: requestedAt,
      updatedAt: requestedAt,
      durationMs: null,
    });
    expect(secondResult).toEqual(firstResult);
  });

  it('list는 inclusive cursor와 limit + 1을 bind하고 lookahead를 nextCursor로 돌려준다', async () => {
    const database = makeDatabaseDouble();

    vi.mocked(database.getAllAsync).mockResolvedValue([
      {
        id: 'meeting-3',
        title: '셋',
        started_at_ms: 300,
        created_at_ms: 300,
        updated_at_ms: 300,
      },
      {
        id: 'meeting-2',
        title: '둘',
        started_at_ms: 200,
        created_at_ms: 200,
        updated_at_ms: 200,
      },
      {
        id: 'meeting-1',
        title: '하나',
        started_at_ms: 100,
        created_at_ms: 100,
        updated_at_ms: 100,
      },
    ]);

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));
    const result = await repository.list({
      yearStartMs: 0,
      nextYearStartMs: 1_000,
      limit: 2,
      cursor: {
        startedAtMs: 300,
        meetingId: 'meeting-3',
      },
    });
    const [sql] = vi.mocked(database.getAllAsync).mock.calls[0] ?? [];
    const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();

    expect(normalizedSql).toContain(
      'AND ( ? IS NULL OR started_at_ms < ? OR (started_at_ms = ? AND id <= ?) ) ' +
        'ORDER BY started_at_ms DESC, id DESC LIMIT ?',
    );
    expect(database.getAllAsync).toHaveBeenCalledWith(
      expect.any(String),
      0,
      1_000,
      300,
      300,
      300,
      'meeting-3',
      3,
    );
    expect(result.meetings.map((meeting) => meeting.id)).toEqual(['meeting-3', 'meeting-2']);
    expect(result.nextCursor).toEqual({
      startedAtMs: 100,
      meetingId: 'meeting-1',
    });
  });
});
