import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateToVersion1 } from './v1';
import { migrateToVersion2 } from './v2';
import { migrateToVersion3 } from './v3';

type DatabaseMigration = {
  version: number;
  migrate: (database: SQLiteDatabase) => Promise<void>;
};

// version이 올라가는 순서대로 한 줄씩 등록한다.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 1, migrate: migrateToVersion1 },
  { version: 2, migrate: migrateToVersion2 },
  { version: 3, migrate: migrateToVersion3 },
];
