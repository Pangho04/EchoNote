import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateToVersion1 } from './v1';

type DatabaseMigration = {
  version: number;
  migrate: (database: SQLiteDatabase) => Promise<void>;
};

// version이 올라가는 순서대로 한 줄씩 등록한다.
// version 2가 생기면 별도 파일을 import하고 여기에 항목 하나만 추가한다.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 1, migrate: migrateToVersion1 },
];
