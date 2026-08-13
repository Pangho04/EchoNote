import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '@/shared/platform/database/migrate-database';

import { createSQLiteMeetingRepository } from './sqlite-meeting-repository';

type SQLiteValue = string | number | null;

function createSQLiteAdapter(database: DatabaseSync) {
  return {
    async execAsync(sql: string) {
      database.exec(sql);
    },
    async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
      return database.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
      return database.prepare(sql).get(...params) as T | null;
    },
    async runAsync(sql: string, ...params: SQLiteValue[]) {
      return database.prepare(sql).run(...params);
    },
    async withTransactionAsync(task: () => Promise<void>) {
      database.exec('BEGIN');

      try {
        await task();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');

        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

describe('SQLiteMeetingRepository integration', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it('createdAt 동률 정렬과 inclusive cursor를 두 page에서 중복·누락 없이 적용한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const repository = createSQLiteMeetingRepository(adapter);

    await repository.create({
      meetingId: 'meeting-d',
      title: '넷',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    await repository.create({
      meetingId: 'meeting-c',
      title: '셋',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    await repository.create({
      meetingId: 'meeting-b',
      title: '둘',
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    await repository.create({
      meetingId: 'meeting-a',
      title: '하나',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    const firstPage = await repository.list({
      yearStartMs: Date.parse('2026-01-01T00:00:00.000Z'),
      nextYearStartMs: Date.parse('2027-01-01T00:00:00.000Z'),
      limit: 2,
    });
    const secondPage = await repository.list({
      yearStartMs: Date.parse('2026-01-01T00:00:00.000Z'),
      nextYearStartMs: Date.parse('2027-01-01T00:00:00.000Z'),
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.meetings.map(({ id }) => id)).toEqual(['meeting-d', 'meeting-c']);
    expect(firstPage.nextCursor).toEqual({
      createdAtMs: Date.parse('2026-01-03T00:00:00.000Z'),
      meetingId: 'meeting-b',
    });
    expect(secondPage.meetings.map(({ id }) => id)).toEqual(['meeting-b', 'meeting-a']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('같은 meetingId는 동일 생성 입력만 멱등 성공으로 인정한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const repository = createSQLiteMeetingRepository(adapter);
    const originalParams = {
      meetingId: 'meeting-1',
      title: '제품 회의',
      createdAt: '2026-08-08T00:11:00.000Z',
    };

    const expectedMeeting = {
      id: originalParams.meetingId,
      title: originalParams.title,
      createdAt: originalParams.createdAt,
    };

    await expect(repository.create(originalParams)).resolves.toMatchObject(expectedMeeting);
    await expect(repository.create(originalParams)).resolves.toMatchObject(expectedMeeting);
    await expect(repository.create({ ...originalParams, title: '다른 제목' })).rejects.toThrow(
      '같은 meetingId에 다른 생성 입력이 이미 저장돼 있습니다: meeting-1',
    );
    await expect(
      repository.create({ ...originalParams, createdAt: '2026-08-08T00:12:00.000Z' }),
    ).rejects.toThrow('같은 meetingId에 다른 생성 입력이 이미 저장돼 있습니다: meeting-1');

    const storedRow = database
      .prepare('SELECT id, title, created_at_ms, updated_at_ms FROM meetings WHERE id = ?')
      .get('meeting-1');

    expect(storedRow).toEqual({
      id: originalParams.meetingId,
      title: originalParams.title,
      created_at_ms: Date.parse(originalParams.createdAt),
      updated_at_ms: Date.parse(originalParams.createdAt),
    });
  });
});
