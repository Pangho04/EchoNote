import { buildServer } from './server.js';

const host = process.env.ECHONOTE_BIND_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.ECHONOTE_GATEWAY_PORT ?? '4317', 10);
const server = buildServer({ logger: true });

try {
  await server.listen({ host, port });

  const shutdown = async () => {
    try {
      await server.close();
    } catch (error) {
      server.log.error(error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
