import type { SQLiteDatabase } from 'expo-sqlite';

// 기존 meetings row와 제약조건은 유지하고, 사용하지 않는 시작 시각 Column만 제거한다.
export async function migrateToVersion2(database: SQLiteDatabase) {
  await database.execAsync(`
    DROP INDEX IF EXISTS idx_meetings_started_at_id;

    ALTER TABLE meetings DROP COLUMN started_at_ms;

    CREATE INDEX idx_meetings_created_at_id
    ON meetings (created_at_ms DESC, id DESC);
  `);
}
