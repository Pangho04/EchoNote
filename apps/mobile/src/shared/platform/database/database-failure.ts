import { CodedError } from '@/shared/lib/coded-error';

// 앱보다 새로운 DB를 만난 경우다. 초기화하면 신버전이 쓴 데이터가 사라지므로 지우지 않는다.
export class UnsupportedDatabaseVersionError extends CodedError {
  readonly code = 'DATABASE_VERSION_UNSUPPORTED';
}

// migration 목록 자체가 잘못된 개발 오류다. 사용자 데이터 문제가 아니다.
export class InvalidMigrationListError extends CodedError {
  readonly code = 'DATABASE_MIGRATION_LIST_INVALID';
}

export type DatabaseFailureKind =
  // 파일이 DB가 아니거나 읽을 수 없다. 초기화로만 복구된다.
  | 'corrupted'
  // 앱을 올려야 열 수 있다. 초기화하면 안 된다.
  | 'unsupported-version'
  // 원인을 특정하지 못했다. 다시 시도만 제안한다.
  | 'unknown';

// SQLite가 파일을 해석하지 못할 때 내는 문구다. 플랫폼마다 표현이 조금씩 다르다.
const CORRUPTION_SIGNS = ['file is not a database', 'malformed', 'SQLITE_CORRUPT', 'SQLITE_NOTADB'];

export function toDatabaseFailureKind(error: unknown): DatabaseFailureKind {
  if (error instanceof UnsupportedDatabaseVersionError) return 'unsupported-version';

  if (!(error instanceof Error)) return 'unknown';

  const message = error.message.toLowerCase();

  if (CORRUPTION_SIGNS.some((sign) => message.includes(sign.toLowerCase()))) return 'corrupted';

  return 'unknown';
}
