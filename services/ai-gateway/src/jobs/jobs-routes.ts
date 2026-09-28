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
};
