import { createSupabaseAccessTokenVerifier } from './auth/supabase-access-token-verifier.js';
import { loadEnvironment } from './config/environment.js';
import { buildServer } from './server.js';

const { supabaseUrl } = loadEnvironment();
const host = process.env.ECHONOTE_BIND_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.ECHONOTE_GATEWAY_PORT ?? '4317', 10);
// Supabase 대시보드 JWT Signing Keys의 Current key 알고리즘과 같아야 한다.
const verifier = createSupabaseAccessTokenVerifier({ algorithms: ['ES256'], supabaseUrl });
const server = buildServer({ logger: true, verifier });

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
