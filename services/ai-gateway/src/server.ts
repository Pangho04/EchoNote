import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';

import type { AccessTokenVerifier } from './auth/access-token-verifier.js';
import { getUserContext, installAuth } from './auth/require-user.js';
import { installWorkerAuth } from './auth/require-worker.js';
import { type JobRepository, JobStoreUnavailableError } from './jobs/job-repository.js';
import { registerJobRoutes } from './jobs/jobs-routes.js';
import { registerUploadCompletionRoutes } from './uploads/upload-completion-routes.js';
import type { IssueUploadGrant } from './uploads/upload-grant-issuer.js';
import { registerUploadGrantRoutes } from './uploads/upload-grant-routes.js';

type BuildServerOptions = {
  issueUploadGrant: IssueUploadGrant;
  jobRepository: JobRepository;
  logger?: FastifyServerOptions['logger'];
  verifier: AccessTokenVerifier;
  workerApiToken: string;
};

export const buildServer = ({
  issueUploadGrant,
  jobRepository,
  logger = false,
  verifier,
  workerApiToken,
}: BuildServerOptions) => {
  const server = Fastify({
    logger,
  });

  server.get('/live', async () => ({
    service: 'echonote-ai-gateway',
    status: 'live' as const,
  }));

  server.get('/ready', async (_request, reply) =>
    reply.code(503).send({
      checks: {
        llm: 'not_configured' as const,
        stt: 'not_configured' as const,
      },
      status: 'not_ready' as const,
    }),
  );

  server.register(
    async (v1) => {
      // 두 자식 캡슐이 이 handler를 물려받는다.
      v1.setErrorHandler((error, request, reply) => {
        // 저장소 일시 장애는 재시도할 수 있어 503으로 응답한다. reason에는 분류 코드만 있다.
        if (error instanceof JobStoreUnavailableError) {
          request.log.warn({ reason: error.reason }, 'job store unavailable');

          return reply.code(503).send({ error: 'job_store_unavailable' });
        }

        const { code, statusCode } =
          typeof error === 'object' && error !== null ? (error as Partial<FastifyError>) : {};

        // 본문 파싱 실패와 미지원 content-type은 invalid_request로 통일한다.
        if (code?.startsWith('FST_ERR_CTP_') && (statusCode === 400 || statusCode === 415)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }

        // 그 밖의 4xx는 Fastify 기본 처리에 넘긴다.
        if (
          typeof statusCode === 'number' &&
          Number.isInteger(statusCode) &&
          statusCode >= 400 &&
          statusCode <= 499
        ) {
          throw error;
        }

        // 4xx가 아닌 오류는 원인을 로그에만 남기고 응답에는 담지 않는다.
        request.log.error({ err: error }, 'unhandled /v1 error');

        return reply.code(500).send({ error: 'internal' });
      });

      // 사용자 JWT와 Worker token은 서로의 route를 열지 못한다.
      v1.register(async (user) => {
        installAuth(user, verifier);

        user.get('/auth-check', async (request) => ({ userId: getUserContext(request).id }));

        registerJobRoutes(user, jobRepository);
        registerUploadGrantRoutes(user, jobRepository, issueUploadGrant);
      });

      v1.register(
        async (worker) => {
          installWorkerAuth(worker, workerApiToken);

          registerUploadCompletionRoutes(worker, jobRepository);
        },
        { prefix: '/worker' },
      );
    },
    { prefix: '/v1' },
  );

  return server;
};
