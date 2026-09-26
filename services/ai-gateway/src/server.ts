import Fastify, { type FastifyServerOptions } from 'fastify';

import type { AccessTokenVerifier } from './auth/access-token-verifier.js';
import { getUserContext, installAuth } from './auth/require-user.js';

type BuildServerOptions = {
  logger?: FastifyServerOptions['logger'];
  verifier: AccessTokenVerifier;
};

export const buildServer = ({ logger = false, verifier }: BuildServerOptions) => {
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

      v1.get('/auth-check', async (request) => ({ userId: getUserContext(request).id }));
    },
    { prefix: '/v1' },
  );

  return server;
};
