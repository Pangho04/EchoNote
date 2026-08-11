import { SQLiteProvider } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';

import { migrateDatabase } from './migrate-database';

// 앱이 항상 같은 로컬 DB 파일을 열도록 이름을 한 곳에 고정한다.
const DATABASE_NAME = 'echonote.db';

export function DatabaseProvider({ children }: PropsWithChildren) {
  // migration 완료 뒤 children을 렌더링하도록 DB 초기화 함수를 Provider에 넘긴다.
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase}>
      {children}
    </SQLiteProvider>
  );
}
