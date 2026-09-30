import { completeJobRequestSchema, jobLeaseRequestSchema } from '@echonote/contracts';
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

  // 6시간 회의 전사가 들어가도록 기본 1 MiB보다 크게, Vercel 본문 상한(4.5 MB) 아래로 받는다.
  // 계약 최대치(20,000개 × 2,000자)는 이보다 커서 넘으면 Fastify가 413을 보낸다.
  instance.post('/jobs/:jobId/complete', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    const completion = completeJobRequestSchema.safeParse(request.body);

    if (!params.success || !completion.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const result = await jobRepository.completeJob({
      jobId: params.data.jobId,
      leaseId: completion.data.leaseId,
      transcript: completion.data.transcript,
    });

    switch (result.kind) {
      case 'completed':
        return reply.code(204).send();

      case 'stale':
        return reply.code(409).send({ error: 'lease_stale' });
    }
  });
};
