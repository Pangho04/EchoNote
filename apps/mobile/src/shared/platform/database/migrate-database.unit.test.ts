import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrate-database';
import { migrateToVersion1 } from './migrations/v1';

type SQLiteAdapterOptions = {
  failDuringVersion2?: boolean;
};

function createSQLiteAdapter(database: DatabaseSync, options: SQLiteAdapterOptions = {}) {
  return {
    async execAsync(sql: string) {
      if (options.failDuringVersion2 && sql.includes('ALTER TABLE meetings')) {
        database.exec(`
          DROP INDEX IF EXISTS idx_meetings_started_at_id;
          ALTER TABLE meetings DROP COLUMN started_at_ms;
        `);

        throw new Error('v2 failure injection');
      }

      database.exec(sql);
    },
    async getFirstAsync<T>(sql: string) {
      return database.prepare(sql).get() as T | null;
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

function getColumnNames(database: DatabaseSync) {
  return database
    .prepare('PRAGMA table_info(meetings)')
    .all()
    .map((row) => String(row.name));
}

function getIndexNames(database: DatabaseSync) {
  return database
    .prepare('PRAGMA index_list(meetings)')
    .all()
    .map((row) => String(row.name));
}

describe('migrateDatabase createdAt schema', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  function openDatabase() {
    const database = new DatabaseSync(':memory:');
    databases.push(database);

    return database;
  }

  it('v1 row의 createdAt·updatedAt을 보존하며 v2 schema로 올린다', async () => {
    const database = openDatabase();
    const adapter = createSQLiteAdapter(database);
    await migrateToVersion1(adapter);
    database.exec(`
      INSERT INTO meetings (id, title, started_at_ms, created_at_ms, updated_at_ms)
      VALUES ('meeting-1', '제품 회의', 100, 200, 300);
      PRAGMA user_version = 1;
    `);

    await migrateDatabase(adapter);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(getColumnNames(database)).toEqual(['id', 'title', 'created_at_ms', 'updated_at_ms']);
    expect(getIndexNames(database)).toContain('idx_meetings_created_at_id');
    expect(getIndexNames(database)).not.toContain('idx_meetings_started_at_id');
    expect(database.prepare('SELECT * FROM meetings').all()).toEqual([
      { id: 'meeting-1', title: '제품 회의', created_at_ms: 200, updated_at_ms: 300 },
    ]);
  });

  it('fresh DB를 v1을 거쳐 v2로 만들고 재실행해도 schema를 바꾸지 않는다', async () => {
    const database = openDatabase();
    const adapter = createSQLiteAdapter(database);

    await migrateDatabase(adapter);
    const firstColumns = getColumnNames(database);
    const firstIndexes = getIndexNames(database);
    await migrateDatabase(adapter);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(getColumnNames(database)).toEqual(firstColumns);
    expect(getIndexNames(database)).toEqual(firstIndexes);
  });

  it('v2 중간 실패 시 v1 schema·index·data·version을 복구한다', async () => {
    const database = openDatabase();
    const initialAdapter = createSQLiteAdapter(database);
    await migrateToVersion1(initialAdapter);
    database.exec(`
      INSERT INTO meetings (id, title, started_at_ms, created_at_ms, updated_at_ms)
      VALUES ('meeting-1', '제품 회의', 100, 200, 300);
      PRAGMA user_version = 1;
    `);
    const failingAdapter = createSQLiteAdapter(database, { failDuringVersion2: true });

    await expect(migrateDatabase(failingAdapter)).rejects.toThrow('v2 failure injection');

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(getColumnNames(database)).toContain('started_at_ms');
    expect(getIndexNames(database)).toContain('idx_meetings_started_at_id');
    expect(database.prepare('SELECT id, started_at_ms, created_at_ms FROM meetings').all()).toEqual(
      [{ id: 'meeting-1', started_at_ms: 100, created_at_ms: 200 }],
    );
  });
});
