import type { SQLiteDatabase } from 'expo-sqlite';

// meeting create/list SQL이 의존할 table과 정렬 index를 함께 준비한다.
export async function migrateToVersion1(database: SQLiteDatabase) {
  await database.execAsync(`
    -- id는 클라이언트가 생성하므로 TEXT primary key를 사용한다.
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY NOT NULL,

      -- trim한 제목은 1~80자여야 한다. 잘못된 Row를 DB 경계에서도 막는다.
      title TEXT NOT NULL
        CHECK (length(trim(title)) BETWEEN 1 AND 80),

      -- timestamp는 정렬·범위 조회가 쉬운 UTC epoch millisecond로 저장한다.
      started_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    -- 목록 정렬과 cursor 비교 순서에 맞춘 복합 index다.
    CREATE INDEX IF NOT EXISTS idx_meetings_started_at_id
    ON meetings (started_at_ms DESC, id DESC);
  `);
}
