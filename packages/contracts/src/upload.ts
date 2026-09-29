import { z } from 'zod';

import { createJobRequestSchema } from './job.js';

export const UPLOAD_GRANT_TTL_SECONDS = 300;
export const UPLOAD_GRANT_ISSUER = 'echonote-ai-gateway';
export const UPLOAD_GRANT_AUDIENCE = 'echonote-upload-receiver';

// Gateway가 서명할 upload grant claim의 계약. 서명·만료 판정은 JWT 라이브러리가 맡는다.
export const uploadGrantClaimsSchema = z
  .object({
    iss: z.literal(UPLOAD_GRANT_ISSUER),
    aud: z.literal(UPLOAD_GRANT_AUDIENCE),
    sub: z.uuid(),
    jti: z.uuid(),
    iat: z.number().int(),
    nbf: z.number().int(),
    exp: z.number().int(),
    job_id: z.uuid(),
    size_bytes: createJobRequestSchema.shape.sizeBytes,
    sha256: createJobRequestSchema.shape.sha256,
    mime_type: createJobRequestSchema.shape.mimeType,
  })
  .refine(({ exp, iat, nbf }) => nbf === iat && exp - iat === UPLOAD_GRANT_TTL_SECONDS, {
    message: `nbf는 iat와 같고 exp는 iat + ${UPLOAD_GRANT_TTL_SECONDS}초여야 합니다.`,
  });

// Worker가 final 파일을 확정한 뒤 Gateway에 보내는 완료 통지. 필드는 grant claim에서 그대로 옮긴다.
export const uploadCompletionRequestSchema = z.strictObject({
  jobId: z.uuid(),
  ownerId: z.uuid(),
  sizeBytes: createJobRequestSchema.shape.sizeBytes,
  sha256: createJobRequestSchema.shape.sha256,
  mimeType: createJobRequestSchema.shape.mimeType,
});

export type UploadCompletionRequest = z.infer<typeof uploadCompletionRequestSchema>;
