import type { SQLiteDatabase } from 'expo-sqlite';

// iOS는 앱 업데이트·재설치 때 앱 컨테이너 경로가 바뀔 수 있어 절대 URI를 저장하면 옛 녹음을 열 수 없다.
// 문서 폴더 기준 상대 경로만 저장하고, 읽을 때 현재 문서 폴더를 앞에 붙인다.
// 기존 행은 모두 createFinalRecordingUri 규칙(recordings/<meetingId>.m4a)으로 저장됐으므로 meeting_id로 다시 만든다.
export async function migrateToVersion4(database: SQLiteDatabase) {
  await database.execAsync(`
    ALTER TABLE recordings RENAME COLUMN uri TO relative_path;

    UPDATE recordings SET relative_path = 'recordings/' || meeting_id || '.m4a';
  `);
}
