import {
  UPLOAD_GRANT_AUDIENCE,
  UPLOAD_GRANT_ISSUER,
  uploadGrantClaimsSchema,
} from '@echonote/contracts';
import { errors, jwtVerify } from 'jose';
import type { z } from 'zod';

export type UploadGrantClaims = z.infer<typeof uploadGrantClaimsSchema>;
export type VerifyUploadGrant = (authorization: string | undefined) => Promise<UploadGrantClaims>;

type UploadGrantVerifierOptions = {
  secret: Uint8Array;
  now?: () => number;
};

// reason은 분류 코드만 담는다. grant 원문과 claim 값은 넣지 않는다.
export class InvalidUploadGrantError extends Error {
  constructor(readonly reason: string) {
    super('invalid upload grant');
  }
}

const BEARER_PATTERN = /^Bearer (\S+)$/i;

// Gateway와 Windows 시계 차이를 흡수하는 허용 오차다.
const CLOCK_TOLERANCE_SECONDS = 30;

export const createUploadGrantVerifier = ({
  secret,
  now = Date.now,
}: UploadGrantVerifierOptions): VerifyUploadGrant => {
  return async (authorization) => {
    const grant = BEARER_PATTERN.exec(authorization ?? '')?.[1];

    if (grant === undefined) throw new InvalidUploadGrantError('missing_bearer');

    let payload: unknown;

    try {
      ({ payload } = await jwtVerify(grant, secret, {
        algorithms: ['HS256'],
        audience: UPLOAD_GRANT_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(now()),
        issuer: UPLOAD_GRANT_ISSUER,
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError) throw new InvalidUploadGrantError(error.code);

      throw error;
    }

    const claims = uploadGrantClaimsSchema.safeParse(payload);

    if (!claims.success) throw new InvalidUploadGrantError('invalid_claims');

    return claims.data;
  };
};
