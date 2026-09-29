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

export type JobSnapshot = {
  id: string;
  meetingId: string;
  status: z.infer<typeof processingJobStatusSchema>;
  sizeBytes: number;
  sha256: string;
  mimeType: z.infer<typeof createJobRequestSchema>['mimeType'];
  createdAt: string;
};

// Worker가 처리 중 주기적으로 보내는 lease 연장 요청. lease_id가 그 job을 가진 Worker라는 유일한 증명이다.
export const renewJobLeaseRequestSchema = z.strictObject({
  leaseId: z.uuid(),
});
