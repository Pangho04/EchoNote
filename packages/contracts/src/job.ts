import { z } from 'zod';

import { identifierSchema } from './identifier.js';

export const processingJobStatusSchema = z.enum([
  'created',
  'queued',
  'processing',
  'completed',
  'failed',
]);

export const processingJobSchema = z.object({
  errorCode: z.string().trim().min(1).nullable(),
  id: identifierSchema,
  meetingId: identifierSchema,
  status: processingJobStatusSchema,
});

export type ProcessingJob = z.infer<typeof processingJobSchema>;

export const createJobRequestSchema = z.strictObject({
  meetingId: z.uuid(),
  sizeBytes: z.number().int().min(1).max(536_870_912),
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

// Worker가 보내는 lease 연장·실패 확정 요청. lease_id가 그 job을 가진 Worker라는 유일한 증명이다.
export const jobLeaseRequestSchema = z.strictObject({
  leaseId: z.uuid(),
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
