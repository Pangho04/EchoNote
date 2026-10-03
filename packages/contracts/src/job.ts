import { z } from 'zod';

import { identifierSchema } from './identifier.js';
import { transcriptResultSchema } from './transcript.js';

export const processingJobStatusSchema = z.enum([
  'created',
  'queued',
  'processing',
  'completed',
  'failed',
]);

// 실패한 job에 남기는 이유. 앱이 사용자 문구로 바꿔 보여 준다. DB check 제약과 같은 목록이다.
export const jobFailureCodeSchema = z.enum([
  'audio_missing',
  'stt_unavailable',
  'stt_failed',
  'result_rejected',
  'attempts_exhausted',
  'unexpected',
]);

export type JobFailureCode = z.infer<typeof jobFailureCodeSchema>;

// 앱이 GET /v1/jobs/:jobId로 받는 job 상태. errorCode는 failed일 때만 값이 있다.
export const processingJobSchema = z.object({
  errorCode: jobFailureCodeSchema.nullable(),
  id: identifierSchema,
  meetingId: identifierSchema,
  status: processingJobStatusSchema,
});

export type ProcessingJob = z.infer<typeof processingJobSchema>;

// 앱이 업로드 전에 같은 한도로 막아 Gateway 400을 받기 전에 안내한다.
export const MAX_UPLOAD_BYTES = 536_870_912;

export const createJobRequestSchema = z.strictObject({
  meetingId: z.uuid(),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.enum(['audio/mp4']),
});

// Gateway가 job을 밖으로 내보내는 형태. createdAt은 UTC ISO 문자열이다.
export const jobSnapshotSchema = z.object({
  id: z.uuid(),
  meetingId: z.uuid(),
  status: processingJobStatusSchema,
  sizeBytes: createJobRequestSchema.shape.sizeBytes,
  sha256: createJobRequestSchema.shape.sha256,
  mimeType: createJobRequestSchema.shape.mimeType,
  createdAt: z.iso.datetime(),
});

export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;

// Worker가 보내는 lease 연장 요청. lease_id가 그 job을 가진 Worker라는 유일한 증명이다.
export const jobLeaseRequestSchema = z.strictObject({
  leaseId: z.uuid(),
});

// Worker가 job을 failed로 확정하는 요청. attempts_exhausted는 DB가 claim 때만 쓴다.
export const failJobRequestSchema = z.strictObject({
  leaseId: jobLeaseRequestSchema.shape.leaseId,
  errorCode: jobFailureCodeSchema.exclude(['attempts_exhausted']),
});

export type FailJobRequest = z.infer<typeof failJobRequestSchema>;

// Worker가 전사 결과를 저장하며 job을 completed로 확정하는 요청.
export const completeJobRequestSchema = z.strictObject({
  leaseId: jobLeaseRequestSchema.shape.leaseId,
  transcript: transcriptResultSchema,
});

// Worker가 받는 응답이라 Gateway가 필드를 더해도 거부하지 않는다.
export const claimJobResponseSchema = z.object({
  job: jobSnapshotSchema,
  lease: z.object({ leaseId: z.uuid(), expiresAt: z.iso.datetime() }),
});

export type ClaimJobResponse = z.infer<typeof claimJobResponseSchema>;

export const renewJobLeaseResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
});
