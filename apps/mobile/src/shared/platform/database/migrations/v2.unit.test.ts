import { describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '.';

describe('migrateToVersion2', () => {
  it('v1 다음에 v2를 연속 등록한다', () => {
    expect(DATABASE_MIGRATIONS.map(({ version }) => version)).toEqual([1, 2]);
  });
});
