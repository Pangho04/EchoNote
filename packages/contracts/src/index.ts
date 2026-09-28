import { z } from 'zod';

import { identifierSchema } from './identifier.js';

export { identifierSchema } from './identifier.js';
export * from './job.js';
export * from './upload.js';

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

export type Meeting = z.infer<typeof meetingSchema>;
export type TranscriptReviewCandidate = z.infer<typeof transcriptReviewCandidateSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
