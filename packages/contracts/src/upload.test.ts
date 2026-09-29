import { describe, expect, it } from 'vitest';

import { uploadCompletionRequestSchema, uploadGrantClaimsSchema } from './index';

const claims = {
  aud: 'echonote-upload-receiver',
  exp: 1_790_000_300,
  iat: 1_790_000_000,
  iss: 'echonote-ai-gateway',
  job_id: '00000000-0000-4000-8000-0000000000f1',
  jti: '00000000-0000-4000-8000-0000000000e1',
  mime_type: 'audio/mp4',
  nbf: 1_790_000_000,
  sha256: 'a'.repeat(64),
  size_bytes: 100,
  sub: '00000000-0000-4000-8000-00000000000a',
};

describe('uploadGrantClaimsSchema', () => {
  it('Gateway가 발급하는 claim을 허용한다', () => {
    expect(uploadGrantClaimsSchema.safeParse(claims).success).toBe(true);
  });

  it.each([
    ['다른 발급자', { iss: 'someone-else' }],
    ['다른 수신자', { aud: 'echonote-ai-gateway' }],
    ['uuid가 아닌 job_id', { job_id: 'job-1' }],
    ['uuid가 아닌 jti', { jti: 'grant-1' }],
    ['300초가 아닌 유효기간', { exp: claims.iat + 3600 }],
    ['iat와 다른 nbf', { nbf: claims.iat + 1 }],
    ['0 byte 파일', { size_bytes: 0 }],
    ['지원하지 않는 MIME', { mime_type: 'audio/wav' }],
  ])('%s를 거부한다', (_label, override) => {
    expect(uploadGrantClaimsSchema.safeParse({ ...claims, ...override }).success).toBe(false);
  });
});

const completion = {
  jobId: '00000000-0000-4000-8000-0000000000f1',
  mimeType: 'audio/mp4',
  ownerId: '00000000-0000-4000-8000-00000000000a',
  sha256: 'a'.repeat(64),
  sizeBytes: 100,
};

describe('uploadCompletionRequestSchema', () => {
  it('Worker가 보내는 완료 통지를 허용한다', () => {
    expect(uploadCompletionRequestSchema.safeParse(completion).success).toBe(true);
  });

  it.each([
    ['uuid가 아닌 jobId', { jobId: 'job-1' }],
    ['uuid가 아닌 ownerId', { ownerId: 'user-1' }],
    ['0 byte 파일', { sizeBytes: 0 }],
    ['대문자 sha256', { sha256: 'A'.repeat(64) }],
    ['지원하지 않는 MIME', { mimeType: 'audio/wav' }],
    ['정의하지 않은 필드', { status: 'queued' }],
  ])('%s를 거부한다', (_label, override) => {
    expect(uploadCompletionRequestSchema.safeParse({ ...completion, ...override }).success).toBe(
      false,
    );
  });
});
