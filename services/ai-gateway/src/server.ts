import Fastify from 'fastify';

type BuildServerOptions = {
  logger?: boolean;
};

export const buildServer = ({ logger = false }: BuildServerOptions = {}) => {
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

  return server;
};
