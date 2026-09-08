import type { SQLiteDatabase } from 'expo-sqlite';

// Meeting과 1:1로 존재하는 Recording을 담는다.
// meeting_id가 Recording의 식별자이자 Meeting FK를 함께 맡으므로, 한 Meeting에
// 두 번째 Recording row를 만들 수 없다. Meeting 삭제 시 Recording도 함께 지운다.
export async function migrateToVersion3(database: SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS recordings (
      meeting_id TEXT PRIMARY KEY NOT NULL
        REFERENCES meetings(id) ON DELETE CASCADE,

      -- 검증을 통과한 최종(영구) URI다. temp URI는 저장하지 않는다.
      uri TEXT NOT NULL,

      -- 실제 파일 byte에서 검증한 MIME 타입이다.
      mime_type TEXT NOT NULL,

      -- 실제 파일 byte에서 계산한 SHA-256 hex 문자열이다.
      sha256 TEXT NOT NULL,

      duration_ms INTEGER NOT NULL,

      -- byte 검증을 통과한 파일만 저장한다.
      byte_size INTEGER NOT NULL CHECK (byte_size > 0)
    );
  `);
}
