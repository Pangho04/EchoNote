import { randomUUID } from 'node:crypto';
import {
  type JobSnapshot,
  UPLOAD_GRANT_AUDIENCE,
  UPLOAD_GRANT_ISSUER,
  UPLOAD_GRANT_TTL_SECONDS,
  uploadGrantClaimsSchema,
} from '@echonote/contracts';
import { SignJWT } from 'jose';

type UploadGrantIssuerOptions = {
  secret: Uint8Array;
  receiverOrigin: string;
  now?: () => number;
  createJti?: () => string;
};

type UploadGrant = { uploadUrl: string; grant: string; expiresAt: string };

export type IssueUploadGrant = (input: {
  ownerId: string;
  job: JobSnapshot;
}) => Promise<UploadGrant>;

export const createUploadGrantIssuer = ({
  secret,
  receiverOrigin,
  now = Date.now,
  createJti = randomUUID,
}: UploadGrantIssuerOptions): IssueUploadGrant => {
  // job은 서명된 job_id claim으로만 식별한다. path에 jobId를 두지 않는다.
  const uploadUrl = new URL('/uploads', receiverOrigin).href;

  return async ({ ownerId, job }) => {
    const issuedAt = Math.floor(now() / 1000);
    // 파일 metadata는 POST /v1/jobs에서 저장한 job row 값이다.
    // 서명 전에 계약 스키마로 검사해 계약을 벗어난 grant를 발급하지 않는다.
    const claims = uploadGrantClaimsSchema.parse({
      iss: UPLOAD_GRANT_ISSUER,
      aud: UPLOAD_GRANT_AUDIENCE,
      sub: ownerId,
      jti: createJti(),
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + UPLOAD_GRANT_TTL_SECONDS,
      job_id: job.id,
      size_bytes: job.sizeBytes,
      sha256: job.sha256,
      mime_type: job.mimeType,
    });

    // 시간 claim을 payload에 직접 넣는다. 인자 없는 setIssuedAt()은 now 대신 실제 시각을 쓴다.
    const grant = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(secret);

    return { expiresAt: new Date(claims.exp * 1000).toISOString(), grant, uploadUrl };
  };
};
