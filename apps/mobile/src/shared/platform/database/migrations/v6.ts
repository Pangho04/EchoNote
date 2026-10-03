import type { SQLiteDatabase } from 'expo-sqlite';

export async function migrateToVersion6(database: SQLiteDatabase) {
  await database.execAsync(`
    -- 회의당 최신 텍스트 변환 시도 1행이다. 다시 시도하면 새 job_id로 덮어쓴다.
    CREATE TABLE meeting_transcriptions (
      meeting_id TEXT PRIMARY KEY NOT NULL
        REFERENCES meetings(id) ON DELETE CASCADE,

      -- Gateway job id다. 서버 상태 조회와 옛 응답 구분에 쓴다.
      job_id TEXT NOT NULL,

      status TEXT NOT NULL
        CHECK (status IN ('created', 'queued', 'processing', 'completed', 'failed')),

      -- 실패 이유는 failed일 때만 둔다. 목록은 서버 jobFailureCodeSchema와 같다.
      error_code TEXT
        CHECK (
          error_code IS NULL
          OR (
            status = 'failed'
            AND error_code IN (
              'audio_missing',
              'stt_unavailable',
              'stt_failed',
              'result_rejected',
              'attempts_exhausted',
              'unexpected'
            )
          )
        ),

      duration_ms INTEGER,
      segments_json TEXT,

      -- 전사 본문은 completed와 함께만 저장한다.
      CHECK ((status = 'completed') = (segments_json IS NOT NULL AND duration_ms IS NOT NULL))
    );
  `);
}
