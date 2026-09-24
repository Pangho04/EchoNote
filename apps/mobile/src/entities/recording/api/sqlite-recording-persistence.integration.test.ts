import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabase } from '@/shared/platform/database/migrate-database';

import { createSQLiteRecordingPersistence } from './sqlite-recording-persistence';

vi.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///document/' } } }));

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

describe('SQLiteRecordingPersistence integration', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it('Meeting과 Recording을 한 transaction으로 함께 저장하고 1:1을 지킨다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const persistence = createSQLiteRecordingPersistence(adapter);
    const createdAt = '2026-08-08T00:11:00.000Z';
    const recording = {
      meetingId: 'meeting-1',
      uri: 'file:///document/recordings/meeting-1.m4a',
      mimeType: 'audio/mp4',
      sha256: 'abc123',
      durationMs: 12_345,
      byteSize: 2048,
    };

    await persistence.saveMeetingWithRecording({
      meeting: { meetingId: 'meeting-1', title: '제품 회의', createdAt },
      recording,
    });

    const meetingRow = database
      .prepare('SELECT id, title, created_at_ms, updated_at_ms FROM meetings WHERE id = ?')
      .get('meeting-1');
    const recordingRow = database
      .prepare('SELECT * FROM recordings WHERE meeting_id = ?')
      .get('meeting-1');

    expect(meetingRow).toEqual({
      id: 'meeting-1',
      title: '제품 회의',
      created_at_ms: Date.parse(createdAt),
      updated_at_ms: Date.parse(createdAt),
    });
    expect(recordingRow).toEqual({
      meeting_id: recording.meetingId,
      relative_path: 'recordings/meeting-1.m4a',
      mime_type: recording.mimeType,
      sha256: recording.sha256,
      duration_ms: recording.durationMs,
      byte_size: recording.byteSize,
    });
  });

  it('같은 meeting_id를 다시 저장하면 회의·녹음 모두 남기지 않고 롤백한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const persistence = createSQLiteRecordingPersistence(adapter);
    const params = {
      meeting: {
        meetingId: 'meeting-1',
        title: '제품 회의',
        createdAt: '2026-08-08T00:11:00.000Z',
      },
      recording: {
        meetingId: 'meeting-1',
        uri: 'file:///document/recordings/a.m4a',
        mimeType: 'audio/mp4',
        sha256: 'abc',
        durationMs: 1000,
        byteSize: 1024,
      },
    };

    await persistence.saveMeetingWithRecording(params);

    await expect(
      persistence.saveMeetingWithRecording({
        ...params,
        recording: { ...params.recording, uri: 'file:///document/recordings/b.m4a' },
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    expect(database.prepare('SELECT COUNT(*) AS count FROM meetings').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM recordings').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT relative_path FROM recordings').get()).toEqual({
      relative_path: 'recordings/a.m4a',
    });
  });

  it('잘못된 createdAt은 SQLite에 bind하기 전에 거부한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const persistence = createSQLiteRecordingPersistence(adapter);

    await expect(
      persistence.saveMeetingWithRecording({
        meeting: { meetingId: 'meeting-1', title: '제품 회의', createdAt: 'invalid' },
        recording: {
          meetingId: 'meeting-1',
          uri: 'file:///document/recordings/a.m4a',
          mimeType: 'audio/mp4',
          sha256: 'abc',
          durationMs: 1000,
          byteSize: 1024,
        },
      }),
    ).rejects.toThrow(RangeError);

    expect(database.prepare('SELECT COUNT(*) AS count FROM meetings').get()).toEqual({ count: 0 });
  });

  it('문서 폴더 밖의 URI는 저장하지 않고 롤백한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const persistence = createSQLiteRecordingPersistence(adapter);

    await expect(
      persistence.saveMeetingWithRecording({
        meeting: {
          meetingId: 'meeting-1',
          title: '제품 회의',
          createdAt: '2026-08-08T00:11:00.000Z',
        },
        recording: {
          meetingId: 'meeting-1',
          uri: 'file:///tmp/a.m4a',
          mimeType: 'audio/mp4',
          sha256: 'abc',
          durationMs: 1000,
          byteSize: 1024,
        },
      }),
    ).rejects.toThrow(RangeError);

    expect(database.prepare('SELECT COUNT(*) AS count FROM meetings').get()).toEqual({ count: 0 });
  });

  describe('deleteMeetingsWithRecordings', () => {
    async function setup(meetingIds: string[]) {
      const database = new DatabaseSync(':memory:');
      databases.push(database);
      const adapter = createSQLiteAdapter(database);
      await migrateDatabase(adapter);
      const persistence = createSQLiteRecordingPersistence(adapter);

      for (const meetingId of meetingIds) {
        await persistence.saveMeetingWithRecording({
          meeting: { meetingId, title: meetingId, createdAt: '2026-08-08T00:11:00.000Z' },
          recording: {
            meetingId,
            uri: `file:///document/recordings/${meetingId}.m4a`,
            mimeType: 'audio/mp4',
            sha256: 'abc',
            durationMs: 1000,
            byteSize: 1024,
          },
        });
      }

      return { database, persistence };
    }

    it('고른 회의와 녹음 행을 함께 지우고 녹음 파일 URI를 돌려준다', async () => {
      const { database, persistence } = await setup(['meeting-1', 'meeting-2', 'meeting-3']);

      const uris = await persistence.deleteMeetingsWithRecordings(['meeting-1', 'meeting-3']);

      expect([...uris].sort()).toEqual([
        'file:///document/recordings/meeting-1.m4a',
        'file:///document/recordings/meeting-3.m4a',
      ]);
      expect(database.prepare('SELECT id FROM meetings').all()).toEqual([{ id: 'meeting-2' }]);
      expect(database.prepare('SELECT meeting_id FROM recordings').all()).toEqual([
        { meeting_id: 'meeting-2' },
      ]);
      expect(
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM recordings r LEFT JOIN meetings m ON m.id = r.meeting_id WHERE m.id IS NULL',
          )
          .get(),
      ).toEqual({ count: 0 });
    });

    it('없는 meetingId는 건너뛰고 빈 목록이면 아무것도 하지 않는다', async () => {
      const { database, persistence } = await setup(['meeting-1']);

      await expect(persistence.deleteMeetingsWithRecordings([])).resolves.toEqual([]);
      await expect(persistence.deleteMeetingsWithRecordings(['missing'])).resolves.toEqual([]);
      expect(database.prepare('SELECT COUNT(*) AS count FROM meetings').get()).toEqual({
        count: 1,
      });
    });
  });
});
