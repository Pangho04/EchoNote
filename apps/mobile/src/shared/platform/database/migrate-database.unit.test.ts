import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { UnsupportedDatabaseVersionError } from './database-failure';
import { migrateDatabase } from './migrate-database';

type SQLiteAdapterOptions = {
  failAfterSchema?: boolean;
};

function createSQLiteAdapter(database: DatabaseSync, options: SQLiteAdapterOptions = {}) {
  return {
    async execAsync(sql: string) {
      database.exec(sql);

      if (options.failAfterSchema && sql.includes('CREATE TABLE IF NOT EXISTS recordings')) {
        throw new Error('v5 failure injection');
      }
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

function getColumnNames(database: DatabaseSync, table: string) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row.name));
}

function getTableNames(database: DatabaseSync) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function getUserVersion(database: DatabaseSync) {
  return database.prepare('PRAGMA user_version').get();
}

// 합치기 전 v4 앱이 만든 DB와 같은 schema다.
function createVersion4Database(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_meetings_created_at_id ON meetings (created_at_ms DESC, id DESC);
    CREATE TABLE recordings (
      meeting_id TEXT PRIMARY KEY NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0)
    );
    INSERT INTO meetings (id, title, created_at_ms, updated_at_ms)
    VALUES ('meeting-1', '제품 회의', 200, 300);
    INSERT INTO recordings (meeting_id, relative_path, mime_type, sha256, duration_ms, byte_size)
    VALUES ('meeting-1', 'recordings/meeting-1.m4a', 'audio/mp4', 'abc', 1000, 1024);
    PRAGMA user_version = 4;
  `);
}

describe('migrateDatabase', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  function openDatabase() {
    const database = new DatabaseSync(':memory:');
    databases.push(database);

    return database;
  }

  it('새 DB에 v5 schema를 만들고 재실행해도 schema를 바꾸지 않는다', async () => {
    const database = openDatabase();
    const adapter = createSQLiteAdapter(database);

    await migrateDatabase(adapter);
    const firstSchema = database.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    await migrateDatabase(adapter);

    expect(getUserVersion(database)).toEqual({ user_version: 5 });
    expect(getTableNames(database)).toEqual(['meetings', 'recordings']);
    expect(getColumnNames(database, 'meetings')).toEqual([
      'id',
      'title',
      'created_at_ms',
      'updated_at_ms',
    ]);
    expect(getColumnNames(database, 'recordings')).toEqual([
      'meeting_id',
      'relative_path',
      'mime_type',
      'sha256',
      'duration_ms',
      'byte_size',
    ]);
    expect(database.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(
      firstSchema,
    );
  });

  it('v4 DB는 데이터를 그대로 두고 version만 5로 올린다', async () => {
    const database = openDatabase();
    createVersion4Database(database);

    await migrateDatabase(createSQLiteAdapter(database));

    expect(getUserVersion(database)).toEqual({ user_version: 5 });
    expect(database.prepare('SELECT * FROM meetings').all()).toEqual([
      { id: 'meeting-1', title: '제품 회의', created_at_ms: 200, updated_at_ms: 300 },
    ]);
    expect(database.prepare('SELECT meeting_id, relative_path FROM recordings').all()).toEqual([
      { meeting_id: 'meeting-1', relative_path: 'recordings/meeting-1.m4a' },
    ]);
  });

  it.each([1, 3, 6])('이어서 올릴 수 없는 version %i DB는 열지 않는다', async (version) => {
    const database = openDatabase();
    database.exec('PRAGMA user_version = ' + version);

    await expect(migrateDatabase(createSQLiteAdapter(database))).rejects.toBeInstanceOf(
      UnsupportedDatabaseVersionError,
    );
    expect(getUserVersion(database)).toEqual({ user_version: version });
  });

  it('v5 중간 실패 시 schema와 version을 되돌린다', async () => {
    const database = openDatabase();
    const adapter = createSQLiteAdapter(database, { failAfterSchema: true });

    await expect(migrateDatabase(adapter)).rejects.toThrow('v5 failure injection');

    expect(getUserVersion(database)).toEqual({ user_version: 0 });
    expect(getTableNames(database)).toEqual([]);
  });
});
