import { uploadGrantClaimsSchema } from '@echonote/contracts';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { createUploadGrantIssuer } from './upload-grant-issuer.js';

const SECRET = new Uint8Array(32).fill(7);
const NOW_MS = 1_790_000_000_500;
const OWNER_ID = '00000000-0000-4000-8000-00000000000a';

const job = {
  createdAt: '2026-09-26T12:53:00.123Z',
  id: '00000000-0000-4000-8000-0000000000f1',
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'created' as const,
};

const createIssuer = () =>
  createUploadGrantIssuer({
    createJti: () => '00000000-0000-4000-8000-0000000000e1',
    now: () => NOW_MS,
    receiverOrigin: 'https://receiver.example.ts.net',
    secret: SECRET,
  });

describe('createUploadGrantIssuer', () => {
  it('HS256 grant에 job row의 파일 metadata와 300초 유효기간을 담는다', async () => {
    const { expiresAt, grant, uploadUrl } = await createIssuer()({ job, ownerId: OWNER_ID });

    const { payload } = await jwtVerify(grant, SECRET, {
      algorithms: ['HS256'],
      audience: 'echonote-upload-receiver',
      currentDate: new Date(NOW_MS),
      issuer: 'echonote-ai-gateway',
    });

    expect(decodeProtectedHeader(grant)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(uploadGrantClaimsSchema.parse(payload)).toEqual({
      aud: 'echonote-upload-receiver',
      exp: 1_790_000_300,
      iat: 1_790_000_000,
      iss: 'echonote-ai-gateway',
      job_id: job.id,
      jti: '00000000-0000-4000-8000-0000000000e1',
      mime_type: 'audio/mp4',
      nbf: 1_790_000_000,
      sha256: job.sha256,
      size_bytes: job.sizeBytes,
      sub: OWNER_ID,
    });
    expect(expiresAt).toBe(new Date(1_790_000_300 * 1000).toISOString());
    expect(uploadUrl).toBe('https://receiver.example.ts.net/uploads');
  });

  it('만료 시각 이후에는 검증에 실패한다', async () => {
    const { grant } = await createIssuer()({ job, ownerId: OWNER_ID });

    await expect(
      jwtVerify(grant, SECRET, { currentDate: new Date((1_790_000_300 + 1) * 1000) }),
    ).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
  });

  it('nbf 이전에는 검증에 실패한다', async () => {
    const { grant } = await createIssuer()({ job, ownerId: OWNER_ID });

    await expect(
      jwtVerify(grant, SECRET, { currentDate: new Date((1_790_000_000 - 1) * 1000) }),
    ).rejects.toMatchObject({ claim: 'nbf', code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' });
  });

  it('다른 secret으로 서명을 검증하면 실패한다', async () => {
    const { grant } = await createIssuer()({ job, ownerId: OWNER_ID });

    await expect(
      jwtVerify(grant, new Uint8Array(32).fill(8), { currentDate: new Date(NOW_MS) }),
    ).rejects.toMatchObject({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
  });

  it('기본 jti는 발급마다 다른 uuid다', async () => {
    const issue = createUploadGrantIssuer({
      now: () => NOW_MS,
      receiverOrigin: 'https://receiver.example.ts.net',
      secret: SECRET,
    });

    const grants = await Promise.all([
      issue({ job, ownerId: OWNER_ID }),
      issue({ job, ownerId: OWNER_ID }),
    ]);
    const jtis = await Promise.all(
      grants.map(
        async ({ grant }) =>
          uploadGrantClaimsSchema.parse(
            (await jwtVerify(grant, SECRET, { currentDate: new Date(NOW_MS) })).payload,
          ).jti,
      ),
    );

    expect(new Set(jtis).size).toBe(2);
  });
});
