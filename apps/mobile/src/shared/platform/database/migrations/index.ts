import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateToVersion5 } from './v5';
import { migrateToVersion6 } from './v6';

type DatabaseMigration = {
  version: number;
  migrate: (database: SQLiteDatabase) => Promise<void>;
};

// version이 올라가는 순서대로 한 줄씩 등록한다.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 5, migrate: migrateToVersion5 },
  { version: 6, migrate: migrateToVersion6 },
];
