import type { SQLiteDatabase } from 'expo-sqlite';

// v1~v4를 합친 schema다. v4 DB는 이미 같은 schema라 IF NOT EXISTS로 아무것도 바꾸지 않는다.
export async function migrateToVersion5(database: SQLiteDatabase) {
  await database.execAsync(`
    -- id는 클라이언트가 생성하므로 TEXT primary key를 사용한다.
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY NOT NULL,

      -- trim한 제목은 1~80자여야 한다. 잘못된 Row를 DB 경계에서도 막는다.
      title TEXT NOT NULL
        CHECK (length(trim(title)) BETWEEN 1 AND 80),

      -- timestamp는 정렬·범위 조회가 쉬운 UTC epoch millisecond로 저장한다.
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    -- 목록 정렬과 cursor 비교 순서에 맞춘 복합 index다.
    CREATE INDEX IF NOT EXISTS idx_meetings_created_at_id
    ON meetings (created_at_ms DESC, id DESC);

    -- Meeting과 1:1로 존재하는 Recording이다. meeting_id가 식별자이자 FK라
    -- 한 Meeting에 두 번째 Recording row를 만들 수 없고, Meeting 삭제 시 함께 지운다.
    CREATE TABLE IF NOT EXISTS recordings (
      meeting_id TEXT PRIMARY KEY NOT NULL
        REFERENCES meetings(id) ON DELETE CASCADE,

      -- 앱 컨테이너 경로는 업데이트·재설치 때 바뀔 수 있어 문서 폴더 기준 상대 경로만 저장한다.
      relative_path TEXT NOT NULL,

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
