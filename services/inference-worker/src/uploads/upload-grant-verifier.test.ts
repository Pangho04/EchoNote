import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { createUploadGrantVerifier, InvalidUploadGrantError } from './upload-grant-verifier.js';

const SECRET = new Uint8Array(32).fill(7);
const NOW_S = 1_790_000_000;

const validClaims = {
  aud: 'echonote-upload-receiver',
  exp: NOW_S + 300,
  iat: NOW_S,
  iss: 'echonote-ai-gateway',
  job_id: '00000000-0000-4000-8000-0000000000f1',
  jti: '00000000-0000-4000-8000-0000000000e1',
  mime_type: 'audio/mp4',
  nbf: NOW_S,
  sha256: 'e'.repeat(64),
  size_bytes: 100,
  sub: '00000000-0000-4000-8000-00000000000a',
};

const sign = (claims: Record<string, unknown> = validClaims, alg = 'HS256', secret = SECRET) =>
  new SignJWT(claims).setProtectedHeader({ alg, typ: 'JWT' }).sign(secret);

const verifyAt = (nowSeconds: number) =>
  createUploadGrantVerifier({ now: () => nowSeconds * 1000, secret: SECRET });

const rejectionOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(InvalidUploadGrantError);

  return (error as InvalidUploadGrantError).reason;
};

describe('createUploadGrantVerifier', () => {
  it('유효한 Bearer grant의 claim을 반환한다', async () => {
    await expect(verifyAt(NOW_S)(`Bearer ${await sign()}`)).resolves.toEqual(validClaims);
  });

  it.each([
    ['누락', undefined],
    ['빈 값', ''],
    ['Bearer가 아닌 scheme', 'Basic abc'],
    ['토큰 없는 Bearer', 'Bearer '],
  ])('Authorization %s는 missing_bearer로 거부한다', async (_label, authorization) => {
    expect(await rejectionOf(verifyAt(NOW_S)(authorization))).toBe('missing_bearer');
  });

  it.each([
    ['위조 서명', () => sign(validClaims, 'HS256', new Uint8Array(32).fill(8))],
    ['wrong aud', () => sign({ ...validClaims, aud: 'other' })],
    ['wrong iss', () => sign({ ...validClaims, iss: 'other' })],
    ['HS512', () => sign(validClaims, 'HS512')],
    [
      'alg none',
      async () => {
        const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

        return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(validClaims)}.`;
      },
    ],
  ])('%s grant는 JOSE 오류 코드로 거부한다', async (_label, createGrant) => {
    expect(await rejectionOf(verifyAt(NOW_S)(`Bearer ${await createGrant()}`))).toMatch(/^ERR_/);
  });

  it.each([
    ['non-uuid job_id', { job_id: 'not-a-uuid' }],
    ['대문자 sha256', { sha256: 'E'.repeat(64) }],
    ['size_bytes 0', { size_bytes: 0 }],
    ['size_bytes 536_870_913', { size_bytes: 536_870_913 }],
    ['audio/mpeg', { mime_type: 'audio/mpeg' }],
  ])('%s claim은 invalid_claims로 거부한다', async (_label, override) => {
    const grant = await sign({ ...validClaims, ...override });

    expect(await rejectionOf(verifyAt(NOW_S)(`Bearer ${grant}`))).toBe('invalid_claims');
  });

  it('nbf 29초 전까지 허용하고 31초 전은 거부한다', async () => {
    const grant = `Bearer ${await sign()}`;

    await expect(verifyAt(NOW_S - 29)(grant)).resolves.toEqual(validClaims);
    expect(await rejectionOf(verifyAt(NOW_S - 31)(grant))).toBe('ERR_JWT_CLAIM_VALIDATION_FAILED');
  });

  it('exp 29초 뒤까지 허용하고 31초 뒤는 거부한다', async () => {
    const grant = `Bearer ${await sign()}`;

    await expect(verifyAt(NOW_S + 300 + 29)(grant)).resolves.toEqual(validClaims);
    expect(await rejectionOf(verifyAt(NOW_S + 300 + 31)(grant))).toBe('ERR_JWT_EXPIRED');
  });
});
