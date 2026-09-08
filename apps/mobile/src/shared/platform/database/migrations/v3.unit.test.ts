import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../migrate-database';
import { DATABASE_MIGRATIONS } from '.';
import { migrateToVersion1 } from './v1';

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

function getRecordingColumns(database: DatabaseSync) {
  return database
    .prepare('PRAGMA table_info(recordings)')
    .all()
    .map((row) => String(row.name));
}

describe('migrateToVersion3', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it('v1 다음에 v2, v3를 연속 등록한다', () => {
    expect(DATABASE_MIGRATIONS.map(({ version }) => version)).toEqual([1, 2, 3]);
  });

  it('v1 Meeting row와 created_at index를 보존하며 v3 recordings table로 올린다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateToVersion1(adapter);
    database.exec(`
      INSERT INTO meetings (id, title, started_at_ms, created_at_ms, updated_at_ms)
      VALUES ('meeting-1', '제품 회의', 100, 200, 300);
    `);

    await migrateDatabase(adapter);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(database.prepare('SELECT * FROM meetings').all()).toEqual([
      { id: 'meeting-1', title: '제품 회의', created_at_ms: 200, updated_at_ms: 300 },
    ]);
    expect(
      database
        .prepare('PRAGMA index_list(meetings)')
        .all()
        .map((row) => String(row.name)),
    ).toContain('idx_meetings_created_at_id');
    expect(getRecordingColumns(database)).toEqual([
      'meeting_id',
      'uri',
      'mime_type',
      'sha256',
      'duration_ms',
      'byte_size',
    ]);
  });

  it('fresh DB를 v3로 만들고 재실행해도 schema를 바꾸지 않는다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);

    await migrateDatabase(adapter);
    const firstColumns = getRecordingColumns(database);
    await migrateDatabase(adapter);

    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(getRecordingColumns(database)).toEqual(firstColumns);
  });

  it('Meeting+Recording pair는 같은 meeting_id로 1:1을 지킨다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);

    database
      .prepare('INSERT INTO meetings (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)')
      .run('meeting-1', '제품 회의', 100, 100);
    const insertRecording = database.prepare(`
      INSERT INTO recordings (meeting_id, uri, mime_type, sha256, duration_ms, byte_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertRecording.run('meeting-1', 'file:///a.m4a', 'audio/mp4', 'abc', 1000, 1024);

    expect(() =>
      insertRecording.run('meeting-1', 'file:///b.m4a', 'audio/mp4', 'def', 2000, 2048),
    ).toThrow(/UNIQUE constraint failed: recordings\.meeting_id/);
  });

  it('존재하지 않는 Meeting을 참조하는 Recording은 FK로 거부된다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO recordings (meeting_id, uri, mime_type, sha256, duration_ms, byte_size)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run('no-such-meeting', 'file:///a.m4a', 'audio/mp4', 'abc', 1000, 1024),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('byte_size가 0 이하인 Recording row는 CHECK로 거부된다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    database
      .prepare('INSERT INTO meetings (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)')
      .run('meeting-1', '제품 회의', 100, 100);

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO recordings (meeting_id, uri, mime_type, sha256, duration_ms, byte_size)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run('meeting-1', 'file:///a.m4a', 'audio/mp4', 'abc', 1000, 0),
    ).toThrow(/CHECK constraint failed/);
  });

  it('Meeting을 삭제하면 CASCADE로 Recording도 함께 삭제된다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    database
      .prepare('INSERT INTO meetings (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)')
      .run('meeting-1', '제품 회의', 100, 100);
    database
      .prepare(
        `
        INSERT INTO recordings (meeting_id, uri, mime_type, sha256, duration_ms, byte_size)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run('meeting-1', 'file:///a.m4a', 'audio/mp4', 'abc', 1000, 1024);

    database.prepare('DELETE FROM meetings WHERE id = ?').run('meeting-1');

    expect(database.prepare('SELECT COUNT(*) AS count FROM recordings').get()).toEqual({
      count: 0,
    });
  });
});
