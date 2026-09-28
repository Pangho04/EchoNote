import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseOwnerId, sendUnauthorized } from '../auth/require-user.js';
import type { JobRepository } from '../jobs/job-repository.js';
import type { IssueUploadGrant } from './upload-grant-issuer.js';

// installAuth가 걸린 캡슐 안에서 호출한다.
export const registerUploadGrantRoutes = (
  instance: FastifyInstance,
  jobRepository: JobRepository,
  issueUploadGrant: IssueUploadGrant,
) => {
  instance.post<{ Params: { jobId: string } }>(
    '/jobs/:jobId/upload-grants',
    async (request, reply) => {
      const ownerId = parseOwnerId(request);

      if (ownerId === undefined) return sendUnauthorized(reply);

      const jobId = z.uuid().safeParse(request.params.jobId);

      // 요청 body를 받지 않는다. grant의 파일 metadata는 저장된 job row에서만 온다.
      if (!jobId.success || request.body !== undefined) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const job = await jobRepository.findOwnedJob({ jobId: jobId.data, ownerId });

      if (job === null) return reply.code(404).send({ error: 'job_not_found' });

      if (job.status !== 'created') return reply.code(409).send({ error: 'job_not_uploadable' });

      const uploadGrant = await issueUploadGrant({ job, ownerId });

      return reply.code(200).header('Cache-Control', 'no-store').send(uploadGrant);
    },
  );
};
