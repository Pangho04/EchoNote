import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openNonceStore } from './nonce-store.js';

const NOW_S = 1_790_000_000;
const now = () => NOW_S * 1000;

let dataDir: string;
let databasePath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'nonce-store-'));
  databasePath = join(dataDir, 'nonces.sqlite');
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

describe('openNonceStore', () => {
  it('같은 jti는 한 번만 소비한다', () => {
    const store = openNonceStore(databasePath, now);

    expect(store.consume('jti-1', NOW_S + 300)).toBe(true);
    expect(store.consume('jti-1', NOW_S + 300)).toBe(false);
    expect(store.consume('jti-2', NOW_S + 300)).toBe(true);
    store.close();
  });

  it('다시 열어도 소비 기록을 유지한다', () => {
    const first = openNonceStore(databasePath, now);

    first.consume('jti-1', NOW_S + 300);
    first.close();

    const reopened = openNonceStore(databasePath, now);

    expect(reopened.consume('jti-1', NOW_S + 300)).toBe(false);
    reopened.close();
  });

  it('열 때 만료 뒤 3600초가 지난 jti만 지운다', () => {
    const first = openNonceStore(databasePath, now);

    first.consume('old', NOW_S - 3601);
    first.consume('recent', NOW_S - 3600);
    first.close();

    openNonceStore(databasePath, now).close();

    const database = new DatabaseSync(databasePath);
    const rows = database.prepare('SELECT jti FROM consumed_nonces ORDER BY jti').all();

    database.close();
    expect(rows).toEqual([{ jti: 'recent' }]);
  });

  it('DB 파일을 열 수 없으면 throw한다', () => {
    expect(() => openNonceStore(join(dataDir, 'missing', 'nonces.sqlite'), now)).toThrow();
  });
});
