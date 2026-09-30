import { createJobRequestSchema } from '@echonote/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseOwnerId, sendUnauthorized } from '../auth/require-user.js';
import type { JobRepository } from './job-repository.js';

// installAuth가 걸린 캡슐 안에서 호출한다.
export const registerJobRoutes = (instance: FastifyInstance, jobRepository: JobRepository) => {
  instance.post('/jobs', async (request, reply) => {
    const ownerId = parseOwnerId(request);

    if (ownerId === undefined) return sendUnauthorized(reply);

    const idempotencyKey = z.uuid().safeParse(request.headers['idempotency-key']);
    const body = createJobRequestSchema.safeParse(request.body);

    if (!idempotencyKey.success || !body.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const result = await jobRepository.createJob({
      ...body.data,
      idempotencyKey: idempotencyKey.data,
      ownerId,
    });

    switch (result.kind) {
      case 'created':
        return reply.code(201).send(result.job);

      case 'existing':
        return reply.code(200).send(result.job);

      case 'conflict':
        return reply.code(409).send({ error: 'idempotency_conflict' });
    }
  });

  // 앱이 전사 진행을 확인한다. errorCode는 failed일 때만 값이 있다.
  instance.get<{ Params: { jobId: string } }>('/jobs/:jobId', async (request, reply) => {
    const ownerId = parseOwnerId(request);

    if (ownerId === undefined) return sendUnauthorized(reply);

    const jobId = z.uuid().safeParse(request.params.jobId);

    if (!jobId.success) return reply.code(400).send({ error: 'invalid_request' });

    // 다른 사용자의 job도 없는 job과 같은 404다.
    const job = await jobRepository.findOwnedJob({ jobId: jobId.data, ownerId });

    reply.header('Cache-Control', 'no-store');

    if (job === null) return reply.code(404).send({ error: 'job_not_found' });

    return reply
      .code(200)
      .send({ errorCode: job.errorCode, id: job.id, meetingId: job.meetingId, status: job.status });
  });

  instance.get<{ Params: { jobId: string } }>('/jobs/:jobId/transcript', async (request, reply) => {
    const ownerId = parseOwnerId(request);

    if (ownerId === undefined) return sendUnauthorized(reply);

    const jobId = z.uuid().safeParse(request.params.jobId);

    if (!jobId.success) return reply.code(400).send({ error: 'invalid_request' });

    // 다른 사용자의 job도 없는 job과 같은 404다.
    const transcript = await jobRepository.findOwnedTranscript({ jobId: jobId.data, ownerId });

    reply.header('Cache-Control', 'no-store');

    if (transcript === null) return reply.code(404).send({ error: 'transcript_not_found' });

    return reply.code(200).send({ jobId: jobId.data, ...transcript });
  });
};
