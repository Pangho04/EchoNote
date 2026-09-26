import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from 'jose';

import {
  type AccessTokenVerifier,
  InvalidAccessTokenError,
  VerifierUnavailableError,
} from './access-token-verifier.js';

type SupabaseAccessTokenVerifierOptions = {
  supabaseUrl: string;
  algorithms: string[];
  jwksTimeoutMs?: number;
};

// 토큰 내용이 틀렸을 때 jose가 내는 코드. 그 밖의 오류(JWKS 응답 실패·timeout·네트워크)는 서버 쪽 장애다.
const INVALID_TOKEN_CODES = new Set([
  errors.JWSSignatureVerificationFailed.code,
  errors.JWTExpired.code,
  errors.JWTClaimValidationFailed.code,
  errors.JWSInvalid.code,
  errors.JWTInvalid.code,
  errors.JOSEAlgNotAllowed.code,
  errors.JOSENotSupported.code,
  errors.JWKSNoMatchingKey.code,
  errors.JWKSMultipleMatchingKeys.code,
]);

const toUnavailableReason = (error: unknown) => {
  if (error instanceof errors.JOSEError) return error.code;

  if (error instanceof Error) return error.name;

  return 'unknown';
};

export const createSupabaseAccessTokenVerifier = ({
  supabaseUrl,
  algorithms,
  jwksTimeoutMs = 5000,
}: SupabaseAccessTokenVerifierOptions): AccessTokenVerifier => {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: jwksTimeoutMs,
  });

  return {
    async verify(token) {
      let payload: JWTPayload;

      try {
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms,
          audience: 'authenticated',
          clockTolerance: '30s',
          issuer,
          requiredClaims: ['exp', 'sub'],
        }));
      } catch (error) {
        // 원본 오류는 cause로 잇지 않는다. jose claim 오류가 payload를 들고 있어 로그로 샐 수 있다.
        if (error instanceof errors.JOSEError && INVALID_TOKEN_CODES.has(error.code)) {
          throw new InvalidAccessTokenError();
        }

        throw new VerifierUnavailableError(toUnavailableReason(error));
      }

      // requiredClaims는 존재만 확인하므로 빈 문자열·비문자열 sub를 따로 거른다.
      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new InvalidAccessTokenError();
      }

      if (payload.is_anonymous === true) throw new InvalidAccessTokenError();

      return { id: payload.sub };
    },
  };
};
