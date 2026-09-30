import { jobLeaseRequestSchema } from '@echonote/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { JobRepository } from './job-repository.js';

const jobParamsSchema = z.strictObject({ jobId: z.uuid() });

// installWorkerAuth가 걸린 캡슐 안에서 호출한다.
export const registerWorkerJobRoutes = (
  instance: FastifyInstance,
  jobRepository: JobRepository,
) => {
  instance.post('/jobs/claim', async (_request, reply) => {
    const result = await jobRepository.claimJob();

    switch (result.kind) {
      case 'claimed':
        return reply.code(200).send({ job: result.job, lease: result.lease });

      case 'idle':
        return reply.code(204).send();
    }
  });

  instance.post('/jobs/:jobId/lease', async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    const renewal = jobLeaseRequestSchema.safeParse(request.body);

    if (!params.success || !renewal.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const result = await jobRepository.renewJobLease({
      jobId: params.data.jobId,
      leaseId: renewal.data.leaseId,
    });

    switch (result.kind) {
      case 'renewed':
        return reply.code(200).send({ expiresAt: result.expiresAt });

      // 이 Worker는 job을 잃었다. 처리를 멈추고 결과를 쓰지 않아야 한다.
      case 'stale':
        return reply.code(409).send({ error: 'lease_stale' });
    }
  });

  instance.post('/jobs/:jobId/fail', async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    const failure = jobLeaseRequestSchema.safeParse(request.body);

    if (!params.success || !failure.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const result = await jobRepository.failJob({
      jobId: params.data.jobId,
      leaseId: failure.data.leaseId,
    });

    switch (result.kind) {
      case 'failed':
        return reply.code(204).send();

      case 'stale':
        return reply.code(409).send({ error: 'lease_stale' });
    }
  });
};
