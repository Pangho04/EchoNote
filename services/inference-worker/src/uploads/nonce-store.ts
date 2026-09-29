import { DatabaseSync } from 'node:sqlite';

export type NonceStore = {
  // 처음 소비한 jti면 true, 이미 소비된 jti면 false다.
  consume: (jti: string, expiresAtSeconds: number) => boolean;
  close: () => void;
};

// 만료 뒤 이 시간이 지난 jti만 지운다. 만료된 grant는 서명 검증에서 먼저 거부된다.
const RETENTION_AFTER_EXPIRY_SECONDS = 3600;

// 파일을 열지 못하면 throw한다. in-memory로 대체하면 재시작 뒤 replay를 막지 못한다.
export const openNonceStore = (path: string, now: () => number = Date.now): NonceStore => {
  const database = new DatabaseSync(path);

  database.exec(
    'CREATE TABLE IF NOT EXISTS consumed_nonces (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL)',
  );
  database
    .prepare('DELETE FROM consumed_nonces WHERE exp < ?')
    .run(Math.floor(now() / 1000) - RETENTION_AFTER_EXPIRY_SECONDS);

  const insert = database.prepare(
    'INSERT INTO consumed_nonces (jti, exp) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );

  return {
    consume: (jti, expiresAtSeconds) => insert.run(jti, expiresAtSeconds).changes === 1,
    close: () => database.close(),
  };
};
