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
    const createdAt = '2026-08-08T00:11:00.000Z';
    const createdAtMs = Date.parse(createdAt);

    vi.mocked(database.runAsync).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    vi.mocked(database.getFirstAsync).mockResolvedValue({
      id: 'meeting-1',
      title: '제품 회의',
      created_at_ms: createdAtMs,
      updated_at_ms: createdAtMs,
    });

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));
    const params = {
      meetingId: 'meeting-1',
      title: '제품 회의',
      createdAt,
    };
    const firstResult = await repository.create(params);
    const secondResult = await repository.create(params);

    expect(database.runAsync).toHaveBeenCalledTimes(2);
    expect(database.runAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('ON CONFLICT(id) DO NOTHING'),
      'meeting-1',
      '제품 회의',
      createdAtMs,
      createdAtMs,
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
      createdAt,
      updatedAt: createdAt,
      durationMs: null,
    });
    expect(secondResult).toEqual(firstResult);
  });

  it.each([
    {
      label: '제목',
      params: {
        meetingId: 'meeting-1',
        title: '다른 제목',
        createdAt: '2026-08-08T00:11:00.000Z',
      },
    },
    {
      label: '등록 시각',
      params: {
        meetingId: 'meeting-1',
        title: '제품 회의',
        createdAt: '2026-08-08T00:12:00.000Z',
      },
    },
  ])('같은 meetingId에 다른 $label 입력이 저장돼 있으면 충돌로 거부한다', async ({ params }) => {
    const database = makeDatabaseDouble();
    const originalCreatedAt = '2026-08-08T00:11:00.000Z';

    vi.mocked(database.runAsync).mockResolvedValue({ changes: 0, lastInsertRowId: 0 });
    vi.mocked(database.getFirstAsync).mockResolvedValue({
      id: 'meeting-1',
      title: '제품 회의',
      created_at_ms: Date.parse(originalCreatedAt),
      updated_at_ms: Date.parse(originalCreatedAt),
    });

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));

    await expect(repository.create(params)).rejects.toThrow(
      '같은 meetingId에 다른 생성 입력이 이미 저장돼 있습니다: meeting-1',
    );
  });

  it('list는 inclusive cursor와 limit + 1을 bind하고 lookahead를 nextCursor로 돌려준다', async () => {
    const database = makeDatabaseDouble();

    vi.mocked(database.getAllAsync).mockResolvedValue([
      {
        id: 'meeting-3',
        title: '셋',
        created_at_ms: 300,
        updated_at_ms: 300,
      },
      {
        id: 'meeting-2',
        title: '둘',
        created_at_ms: 200,
        updated_at_ms: 200,
      },
      {
        id: 'meeting-1',
        title: '하나',
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
        createdAtMs: 300,
        meetingId: 'meeting-3',
      },
    });
    const [sql] = vi.mocked(database.getAllAsync).mock.calls[0] ?? [];
    const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();

    expect(normalizedSql).toContain(
      'AND ( ? IS NULL OR created_at_ms < ? OR (created_at_ms = ? AND id <= ?) ) ' +
        'ORDER BY created_at_ms DESC, id DESC LIMIT ?',
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
      createdAtMs: 100,
      meetingId: 'meeting-1',
    });
  });

  it('잘못된 createdAt은 SQLite에 bind하기 전에 거부한다', async () => {
    const database = makeDatabaseDouble();
    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));

    await expect(
      repository.create({ meetingId: 'meeting-1', title: '제품 회의', createdAt: 'invalid' }),
    ).rejects.toThrow(RangeError);
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it('잘못된 created_at_ms Row를 Domain으로 변환하지 않는다', async () => {
    const database = makeDatabaseDouble();
    vi.mocked(database.getAllAsync).mockResolvedValue([
      { id: 'meeting-1', title: '제품 회의', created_at_ms: Number.NaN, updated_at_ms: 1 },
    ]);
    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));

    await expect(repository.list({ yearStartMs: 0, nextYearStartMs: 2, limit: 1 })).rejects.toThrow(
      RangeError,
    );
  });

  it('getByMeetingId는 meetingId를 bind해 단건 Row를 Domain으로 변환한다', async () => {
    const database = makeDatabaseDouble();
    const createdAt = '2026-08-08T00:11:00.000Z';
    const createdAtMs = Date.parse(createdAt);

    vi.mocked(database.getFirstAsync).mockResolvedValue({
      id: 'meeting-1',
      title: '제품 회의',
      created_at_ms: createdAtMs,
      updated_at_ms: createdAtMs,
    });

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));
    const result = await repository.getByMeetingId('meeting-1');

    expect(database.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = ?'),
      'meeting-1',
    );
    expect(result).toEqual({
      id: 'meeting-1',
      title: '제품 회의',
      status: MeetingStatus.LocalOnly,
      createdAt,
      updatedAt: createdAt,
      durationMs: null,
    });
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it('getByMeetingId는 Row가 없으면 null을 반환한다', async () => {
    const database = makeDatabaseDouble();

    vi.mocked(database.getFirstAsync).mockResolvedValue(null);

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));
    const result = await repository.getByMeetingId('meeting-1');

    expect(result).toBeNull();
  });

  it('getByMeetingId는 잘못된 created_at_ms Row를 Domain으로 변환하지 않는다', async () => {
    const database = makeDatabaseDouble();

    vi.mocked(database.getFirstAsync).mockResolvedValue({
      id: 'meeting-1',
      title: '제품 회의',
      created_at_ms: Number.NaN,
      updated_at_ms: 1,
    });

    const repository = createSQLiteMeetingRepository(asSQLiteDatabase(database));

    await expect(repository.getByMeetingId('meeting-1')).rejects.toThrow(RangeError);
  });
});
