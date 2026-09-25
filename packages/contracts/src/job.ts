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
