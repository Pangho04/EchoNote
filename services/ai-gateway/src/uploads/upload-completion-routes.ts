import { uploadCompletionRequestSchema } from '@echonote/contracts';
import type { FastifyInstance } from 'fastify';

import type { JobRepository } from '../jobs/job-repository.js';

// installWorkerAuth가 걸린 캡슐 안에서 호출한다.
export const registerUploadCompletionRoutes = (
  instance: FastifyInstance,
  jobRepository: JobRepository,
) => {
  instance.post('/upload-completions', async (request, reply) => {
    const completion = uploadCompletionRequestSchema.safeParse(request.body);

    if (!completion.success) return reply.code(400).send({ error: 'invalid_request' });

    const result = await jobRepository.completeUpload(completion.data);

    switch (result.kind) {
      case 'queued':
        return reply.code(201).send(result.job);

      case 'existing':
        return reply.code(200).send(result.job);

      case 'conflict':
        return reply.code(409).send({ error: 'upload_completion_conflict' });

      case 'not_found':
        return reply.code(404).send({ error: 'job_not_found' });
    }
  });
};
