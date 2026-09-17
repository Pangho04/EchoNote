import { deleteDatabaseAsync, type SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { type PropsWithChildren, type ReactElement, useCallback, useRef, useState } from 'react';

import { type DatabaseFailureKind, toDatabaseFailureKind } from './database-failure';
import { DatabaseRecoveryScreen } from './database-recovery-screen';
import { migrateDatabase } from './migrate-database';

// 앱이 항상 같은 로컬 DB 파일을 열도록 이름을 한 곳에 고정한다.
const DATABASE_NAME = 'echonote.db';

export function DatabaseProvider({ children }: PropsWithChildren): ReactElement {
  const [failure, setFailure] = useState<DatabaseFailureKind | null>(null);

  // Provider를 다시 마운트해 DB 열기를 처음부터 재시도하기 위한 키다.
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);

  // 초기화가 실패해도 열린 핸들은 남는다. 닫지 않고 지우면 네이티브가 삭제를 거부한다.
  const databaseRef = useRef<SQLiteDatabase | null>(null);

  // onInit·onError는 참조가 바뀌면 SQLiteProvider가 DB를 다시 열고 하위 트리를 재마운트한다.
  // 그러면 열려 있던 화면과 deep link로 이동한 경로가 초기화된다.
  const initializeDatabase = useCallback(async (database: SQLiteDatabase) => {
    databaseRef.current = database;

    await migrateDatabase(database);
  }, []);

  async function resetDatabase() {
    try {
      await databaseRef.current?.closeAsync();
    } catch {
      // 이미 닫혔거나 열린 적이 없다. 삭제를 막지 않는다.
    }

    databaseRef.current = null;

    try {
      await deleteDatabaseAsync(DATABASE_NAME);
    } catch {
      // 삭제까지 실패하면 복구 화면을 그대로 두고 다시 시도하게 한다.
      return;
    }

    retry();
  }

  function retry() {
    attemptRef.current += 1;

    setFailure(null);
    setAttempt(attemptRef.current);
  }

  const handleError = useCallback((error: Error) => {
    const raisedAttempt = attemptRef.current;
    const kind = toDatabaseFailureKind(error);

    // onError는 SQLiteProvider가 렌더하는 동안 불릴 수 있어 상태 변경을 다음 tick으로 미룬다.
    // 폐기된 시도에서 뒤늦게 도착한 오류는 새 시도의 결과를 덮지 않는다.
    queueMicrotask(() => {
      if (raisedAttempt !== attemptRef.current) return;

      setFailure(kind);
    });
  }, []);

  // DB를 열지 못하면 children을 그릴 수 없다. onError가 없으면 오류가 그대로 위로 올라가
  // 앱 전체가 흰 화면이 된다.
  if (failure) {
    return <DatabaseRecoveryScreen kind={failure} onReset={resetDatabase} onRetry={retry} />;
  }

  // migration 완료 뒤 children을 렌더링하도록 DB 초기화 함수를 Provider에 넘긴다.
  return (
    <SQLiteProvider
      databaseName={DATABASE_NAME}
      key={attempt}
      onError={handleError}
      onInit={initializeDatabase}
    >
      {children}
    </SQLiteProvider>
  );
}
