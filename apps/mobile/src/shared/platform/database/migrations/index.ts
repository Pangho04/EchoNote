import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateToVersion5 } from './v5';

type DatabaseMigration = {
  version: number;
  migrate: (database: SQLiteDatabase) => Promise<void>;
};

// version이 올라가는 순서대로 한 줄씩 등록한다.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 5, migrate: migrateToVersion5 },
];
