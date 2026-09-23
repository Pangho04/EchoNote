import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabase } from '@/shared/platform/database/migrate-database';

import { createSQLiteRecordingPersistence } from './sqlite-recording-persistence';
import { createSQLiteRecordingRepository } from './sqlite-recording-repository';

vi.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///document/' } } }));

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

describe('SQLiteRecordingRepository integration', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it('저장한 Recording을 meetingId로 읽어 Domain으로 변환한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const persistence = createSQLiteRecordingPersistence(adapter);
    const repository = createSQLiteRecordingRepository(adapter);
    const recording = {
      meetingId: 'meeting-1',
      uri: 'file:///document/recordings/meeting-1.m4a',
      mimeType: 'audio/mp4',
      sha256: 'abc123',
      durationMs: 12_345,
      byteSize: 2048,
    };

    await persistence.saveMeetingWithRecording({
      meeting: {
        meetingId: 'meeting-1',
        title: '제품 회의',
        createdAt: '2026-08-08T00:11:00.000Z',
      },
      recording,
    });

    await expect(repository.getSavedByMeetingId('meeting-1')).resolves.toEqual(recording);
  });

  it('저장한 적 없는 meetingId는 null을 반환한다', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const adapter = createSQLiteAdapter(database);
    await migrateDatabase(adapter);
    const repository = createSQLiteRecordingRepository(adapter);

    await expect(repository.getSavedByMeetingId('no-such-meeting')).resolves.toBeNull();
  });
});
