import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';

import type { AccessTokenVerifier } from './auth/access-token-verifier.js';
import { getUserContext, installAuth } from './auth/require-user.js';
import type { JobRepository } from './jobs/job-repository.js';
import { registerJobRoutes } from './jobs/jobs-routes.js';

type BuildServerOptions = {
  jobRepository: JobRepository;
  logger?: FastifyServerOptions['logger'];
  verifier: AccessTokenVerifier;
};

export const buildServer = ({ jobRepository, logger = false, verifier }: BuildServerOptions) => {
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
      installAuth(v1, verifier);

      // 본문 파싱 실패와 미지원 content-type은 invalid_request로 통일하고, 그 밖의 4xx는 기본 처리에 넘긴다.
      // 5xx와 statusCode 없는 오류는 원인을 로그에만 남기고 응답에는 담지 않는다.
      v1.setErrorHandler((error, request, reply) => {
        const { code, statusCode } =
          typeof error === 'object' && error !== null ? (error as Partial<FastifyError>) : {};

        if (code?.startsWith('FST_ERR_CTP_') && (statusCode === 400 || statusCode === 415)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }

        if (
          typeof statusCode === 'number' &&
          Number.isInteger(statusCode) &&
          statusCode >= 400 &&
          statusCode <= 499
        ) {
          throw error;
        }

        request.log.error({ err: error }, 'unhandled /v1 error');

        return reply.code(500).send({ error: 'internal' });
      });

      v1.get('/auth-check', async (request) => ({ userId: getUserContext(request).id }));

      registerJobRoutes(v1, jobRepository);
    },
    { prefix: '/v1' },
  );

  return server;
};
