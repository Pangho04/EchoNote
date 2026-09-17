import { describe, expect, it } from 'vitest';

import {
  InvalidMigrationListError,
  toDatabaseFailureKind,
  UnsupportedDatabaseVersionError,
} from './database-failure';

describe('toDatabaseFailureKind', () => {
  it('앱보다 새로운 DB version은 초기화 대상이 아니다', () => {
    const error = new UnsupportedDatabaseVersionError(
      '현재 앱이 지원하지 않는 DB version입니다: 9',
    );

    expect(toDatabaseFailureKind(error)).toBe('unsupported-version');
  });

  it.each([
    'Call to function NativeDatabase.execAsync has been rejected. Caused by: file is not a database',
    'SQLITE_CORRUPT: database disk image is malformed',
    'SQLITE_NOTADB',
  ])('파일을 해석하지 못하는 오류는 손상으로 본다: %s', (message) => {
    expect(toDatabaseFailureKind(new Error(message))).toBe('corrupted');
  });

  it('migration 목록 오류는 사용자 데이터 문제가 아니므로 손상으로 보지 않는다', () => {
    const error = new InvalidMigrationListError('순서가 어긋난 DB migration입니다: 3');

    expect(toDatabaseFailureKind(error)).toBe('unknown');
  });

  it('Error가 아닌 값도 삼키지 않고 unknown으로 돌려준다', () => {
    expect(toDatabaseFailureKind('boom')).toBe('unknown');
    expect(toDatabaseFailureKind(undefined)).toBe('unknown');
  });
});
