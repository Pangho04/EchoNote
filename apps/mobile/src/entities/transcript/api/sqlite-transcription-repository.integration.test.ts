import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '@/shared/platform/database/migrate-database';

import { createSQLiteTranscriptionRepository } from './sqlite-transcription-repository';

type SQLiteValue = string | number | null;

const MEETING_ID = 'meeting-1';
const JOB_A = '00000000-0000-4000-8000-00000000000a';
const JOB_B = '00000000-0000-4000-8000-00000000000b';
const CONTENT = { durationMs: 3000, segments: [{ startMs: 0, endMs: 1000, text: '안녕하세요' }] };

function createSQLiteAdapter(database: DatabaseSync) {
  return {
    async execAsync(sql: string) {
      database.exec(sql);
    },
    async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) {
      return database.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) {
      return (database.prepare(sql).get(...params) ?? null) as T | null;
    },
    async runAsync(sql: string, ...params: SQLiteValue[]) {
      const { changes } = database.prepare(sql).run(...params);

      return { changes: Number(changes) };
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

describe('SQLiteTranscriptionRepository integration', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  async function setup() {
    const database = new DatabaseSync(':memory:');

    databases.push(database);
    await migrateDatabase(createSQLiteAdapter(database));
    database
      .prepare('INSERT INTO meetings (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, 0, 0)')
      .run(MEETING_ID, '회의');

    return {
      database,
      repository: createSQLiteTranscriptionRepository(createSQLiteAdapter(database)),
    };
  }

  function insertRaw(database: DatabaseSync, columns: Record<string, SQLiteValue>) {
    const row = { meeting_id: MEETING_ID, ...columns };

    database
      .prepare(
        `INSERT INTO meeting_transcriptions (${Object.keys(row).join(', ')})
        VALUES (${Object.keys(row)
          .map(() => '?')
          .join(', ')})`,
      )
      .run(...Object.values(row));
  }

  it('행이 없으면 none이다', async () => {
    const { repository } = await setup();

    await expect(repository.get(MEETING_ID)).resolves.toEqual({ kind: 'none' });
  });

  it('upsertCreated는 failed 행을 새 job의 created로 덮어쓴다', async () => {
    const { repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_A);
    await repository.updateStatus(MEETING_ID, JOB_A, 'failed', 'stt_failed');

    await expect(repository.upsertCreated(MEETING_ID, JOB_B)).resolves.toBe(true);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'created', jobId: JOB_B },
    });
  });

  it('completed 행은 upsertCreated·updateStatus·delete가 바꾸지 못한다', async () => {
    const { repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_A);
    await repository.saveCompleted(MEETING_ID, JOB_A, CONTENT);

    await expect(repository.upsertCreated(MEETING_ID, JOB_B)).resolves.toBe(false);
    await expect(repository.updateStatus(MEETING_ID, JOB_A, 'processing', null)).resolves.toBe(
      false,
    );
    await expect(repository.delete(MEETING_ID, JOB_A)).resolves.toBe(false);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'completed', jobId: JOB_A, content: CONTENT },
    });
  });

  it('옛 job_id의 UPDATE·DELETE·saveCompleted는 0행이다', async () => {
    const { repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_B);

    await expect(repository.updateStatus(MEETING_ID, JOB_A, 'queued', null)).resolves.toBe(false);
    await expect(repository.saveCompleted(MEETING_ID, JOB_A, CONTENT)).resolves.toBe(false);
    await expect(repository.delete(MEETING_ID, JOB_A)).resolves.toBe(false);
    await expect(repository.deleteCorrupt(MEETING_ID, JOB_A)).resolves.toBe(false);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'created', jobId: JOB_B },
    });
  });

  it('updateStatus는 failed일 때만 error_code를 남긴다', async () => {
    const { repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_A);
    await repository.updateStatus(MEETING_ID, JOB_A, 'failed', 'audio_missing');

    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'failed', jobId: JOB_A, errorCode: 'audio_missing' },
    });

    await repository.updateStatus(MEETING_ID, JOB_A, 'processing', 'audio_missing');

    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'processing', jobId: JOB_A },
    });
  });

  it('delete는 진행 중 행을 지운다', async () => {
    const { repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_A);

    await expect(repository.delete(MEETING_ID, JOB_A)).resolves.toBe(true);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({ kind: 'none' });
  });

  it.each<[string, Record<string, SQLiteValue>]>([
    ['UUID가 아닌 job_id', { job_id: 'job-1', status: 'queued' }],
    [
      'JSON이 아닌 segments',
      { job_id: JOB_A, status: 'completed', duration_ms: 1, segments_json: '{' },
    ],
    [
      '스키마에 맞지 않는 segments',
      { job_id: JOB_A, status: 'completed', duration_ms: 1, segments_json: '[{"text":""}]' },
    ],
  ])('%s 행은 corrupt로 원문 status·job_id를 넘긴다', async (_label, columns) => {
    const { database, repository } = await setup();

    insertRaw(database, columns);

    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'corrupt',
      status: columns.status,
      jobId: columns.job_id,
    });
  });

  it('deleteCorrupt는 원문 job_id로 completed 손상 행도 지운다', async () => {
    const { database, repository } = await setup();

    insertRaw(database, {
      job_id: 'job-1',
      status: 'completed',
      duration_ms: 1,
      segments_json: '[]',
    });

    await expect(repository.deleteCorrupt(MEETING_ID, 'job-1')).resolves.toBe(true);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({ kind: 'none' });
  });

  it('saveCompleted는 손상된 completed 행을 덮어쓴다', async () => {
    const { database, repository } = await setup();

    insertRaw(database, { job_id: JOB_A, status: 'completed', duration_ms: 1, segments_json: '{' });

    await expect(repository.saveCompleted(MEETING_ID, JOB_A, CONTENT)).resolves.toBe(true);
    await expect(repository.get(MEETING_ID)).resolves.toEqual({
      kind: 'row',
      transcription: { status: 'completed', jobId: JOB_A, content: CONTENT },
    });
  });

  it.each<[string, Record<string, SQLiteValue>]>([
    ['모르는 status', { job_id: JOB_A, status: 'uploading' }],
    ['failed 외 error_code', { job_id: JOB_A, status: 'queued', error_code: 'stt_failed' }],
    ['segments 없는 completed', { job_id: JOB_A, status: 'completed' }],
    [
      'completed 아닌데 segments',
      { job_id: JOB_A, status: 'queued', duration_ms: 1, segments_json: '[]' },
    ],
  ])('CHECK가 %s 행을 거부한다', async (_label, columns) => {
    const { database } = await setup();

    expect(() => insertRaw(database, columns)).toThrow(/CHECK/);
  });

  it('회의를 지우면 전사 행도 지운다', async () => {
    const { database, repository } = await setup();

    await repository.upsertCreated(MEETING_ID, JOB_A);
    database.exec('PRAGMA foreign_keys = ON');
    database.prepare('DELETE FROM meetings WHERE id = ?').run(MEETING_ID);

    await expect(repository.get(MEETING_ID)).resolves.toEqual({ kind: 'none' });
  });
});
