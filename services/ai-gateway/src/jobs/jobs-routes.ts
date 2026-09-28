import { createJobRequestSchema } from '@echonote/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getUserContext } from '../auth/require-user.js';
import {
  type CreateJobResult,
  type JobRepository,
  JobStoreUnavailableError,
} from './job-repository.js';

// installAuth가 걸린 캡슐 안에서 호출한다.
export const registerJobRoutes = (instance: FastifyInstance, jobRepository: JobRepository) => {
  instance.post('/jobs', async (request, reply) => {
    // jobs.owner_id가 uuid다. uuid가 아닌 sub는 이 API의 사용자가 될 수 없다.
    const ownerId = z.uuid().safeParse(getUserContext(request).id);

    if (!ownerId.success) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }

    const idempotencyKey = z.uuid().safeParse(request.headers['idempotency-key']);
    const body = createJobRequestSchema.safeParse(request.body);

    if (!idempotencyKey.success || !body.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    let result: CreateJobResult;

    try {
      result = await jobRepository.createJob({
        ...body.data,
        idempotencyKey: idempotencyKey.data,
        ownerId: ownerId.data,
      });
    } catch (error) {
      if (error instanceof JobStoreUnavailableError) {
        request.log.warn({ reason: error.reason }, 'job store unavailable');

        return reply.code(503).send({ error: 'job_store_unavailable' });
      }

      throw error;
    }

    switch (result.kind) {
      case 'created':
        return reply.code(201).send(result.job);

      case 'existing':
        return reply.code(200).send(result.job);

      case 'conflict':
        return reply.code(409).send({ error: 'idempotency_conflict' });
    }
  });
};
