import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../migrate-database';
import { migrateToVersion1 } from './v1';
import { migrateToVersion2 } from './v2';
import { migrateToVersion3 } from './v3';

type SQLiteValue = string | number | null;

function createSQLiteAdapter(database: DatabaseSync) {
  return {
    async execAsync(sql: string) {
      database.exec(sql);
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

describe('migrateToVersion4', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it('v3 절대 URI를 meeting_id 기준 상대 경로로 바꾸고 열 이름을 relative_path로 바꾼다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);

    await migrateToVersion1(adapter);
    await migrateToVersion2(adapter);
    await migrateToVersion3(adapter);
    database.exec(`
      INSERT INTO meetings (id, title, created_at_ms, updated_at_ms)
      VALUES ('meeting-1', '제품 회의', 100, 100);
      INSERT INTO recordings (meeting_id, uri, mime_type, sha256, duration_ms, byte_size)
      VALUES (
        'meeting-1',
        'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/recordings/meeting-1.m4a',
        'audio/mp4', 'abc', 1000, 1024
      );
      PRAGMA user_version = 3;
    `);

    await migrateDatabase(adapter);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(database.prepare('SELECT meeting_id, relative_path FROM recordings').all()).toEqual([
      { meeting_id: 'meeting-1', relative_path: 'recordings/meeting-1.m4a' },
    ]);
  });
});
