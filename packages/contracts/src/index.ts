import { z } from 'zod';

export const identifierSchema = z.string().trim().min(1);

export const processingJobStatusSchema = z.enum([
  'waiting_for_node',
  'queued',
  'uploading',
  'transcribing',
  'reviewing',
  'summarizing',
  'completed',
  'cancelled',
  'failed',
]);

export const transcriptSegmentSchema = z
  .object({
    endMs: z.number().int().nonnegative(),
    id: identifierSchema,
    speakerLabel: z.string().trim().min(1).nullable(),
    startMs: z.number().int().nonnegative(),
    text: z.string().trim().min(1),
  })
  .refine(({ endMs, startMs }) => endMs >= startMs, {
    message: 'endMs는 startMs보다 빠를 수 없습니다.',
    path: ['endMs'],
  });

export const transcriptReviewCandidateSchema = z
  .object({
    confidence: z.number().min(0).max(1).nullable(),
    endMs: z.number().int().nonnegative(),
    id: identifierSchema,
    originalText: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    startMs: z.number().int().nonnegative(),
    suggestedText: z.string().trim().min(1),
  })
  .refine(({ endMs, startMs }) => endMs >= startMs, {
    message: 'endMs는 startMs보다 빠를 수 없습니다.',
    path: ['endMs'],
  });

export const transcriptReviewQueueSchema = z.array(transcriptReviewCandidateSchema).max(20);

export const meetingSchema = z.object({
  createdAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  id: identifierSchema,
  title: z.string().trim().min(1),
  updatedAt: z.iso.datetime(),
});

export const processingJobSchema = z.object({
  errorCode: z.string().trim().min(1).nullable(),
  id: identifierSchema,
  meetingId: identifierSchema,
  status: processingJobStatusSchema,
});

export type Meeting = z.infer<typeof meetingSchema>;
export type ProcessingJob = z.infer<typeof processingJobSchema>;
export type TranscriptReviewCandidate = z.infer<typeof transcriptReviewCandidateSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
