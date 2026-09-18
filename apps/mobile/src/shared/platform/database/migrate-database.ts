import type { SQLiteDatabase } from 'expo-sqlite';

import { InvalidMigrationListError, UnsupportedDatabaseVersionError } from './database-failure';
import { DATABASE_MIGRATIONS } from './migrations';

type UserVersionRow = {
  user_version: number;
};

// migration 목록의 마지막 항목을 앱이 이해하는 최신 schema version으로 삼는다.
const DATABASE_VERSION = DATABASE_MIGRATIONS[DATABASE_MIGRATIONS.length - 1]?.version ?? 0;

// migration 목록 전체가 1, 2, 3처럼 빈칸·중복 없이 정렬됐는지 먼저 검사한다.
// 이미 migration을 적용한 DB를 열어도 잘못된 목록을 놓치지 않는다.
for (const [index, migration] of DATABASE_MIGRATIONS.entries()) {
  const expectedVersion = index + 1;

  if (migration.version !== expectedVersion) {
    throw new InvalidMigrationListError('순서가 어긋난 DB migration입니다: ' + migration.version);
  }
}

export async function migrateDatabase(database: SQLiteDatabase) {
  // WAL은 커밋마다 DB 파일을 덮어쓰는 대신 변경을 덧붙여 fsync 횟수를 줄인다.
  // 연결이 하나인 지금은 읽기·쓰기 동시성 이득이 없다. outbox처럼 두 번째 연결이
  // 생기면 그때 의미가 커진다.
  await database.execAsync('PRAGMA journal_mode = WAL');

  // SQLite FK 검사는 connection마다 꺼져 있을 수 있어 open 때 활성화한다.
  await database.execAsync('PRAGMA foreign_keys = ON');

  // DB 파일 자체에 저장된 현재 schema version을 읽는다. 새 DB는 0이다.
  const versionRow = await database.getFirstAsync<UserVersionRow>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  // 더 최신 앱이 만든 DB를 구버전 코드로 열면 schema 해석이 틀릴 수 있다.
  if (currentVersion > DATABASE_VERSION) {
    throw new UnsupportedDatabaseVersionError(
      '현재 앱이 지원하지 않는 DB version입니다: ' + currentVersion,
    );
  }

  // 이미 최신이면 schema SQL을 다시 실행하지 않고 끝낸다.
  if (currentVersion === DATABASE_VERSION) {
    return;
  }

  // 필요한 migration과 version 갱신을 한 transaction으로 묶어 부분 적용을 막는다.
  await database.withTransactionAsync(async () => {
    let nextVersion = currentVersion + 1;

    for (const migration of DATABASE_MIGRATIONS) {
      if (migration.version <= currentVersion) {
        continue;
      }

      // version 1 다음에 3이 오는 migration 목록 실수를 SQL 실행 전에 막는다.
      if (migration.version !== nextVersion) {
        throw new InvalidMigrationListError(
          '순서가 어긋난 DB migration입니다: ' + migration.version,
        );
      }

      // 현재 version에 필요한 version 함수만 실행한다.
      await migration.migrate(database);

      nextVersion = migration.version + 1;
    }

    // migration 목록 누락으로 최신 version에 도달하지 못한 개발 오류를 드러낸다.
    if (nextVersion !== DATABASE_VERSION + 1) {
      throw new InvalidMigrationListError('적용되지 않은 DB migration이 있습니다.');
    }

    // 모든 schema 변경이 성공한 뒤에만 DB version을 확정한다.
    await database.execAsync('PRAGMA user_version = ' + DATABASE_VERSION);
  });
}
