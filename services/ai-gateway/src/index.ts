// Vercel fastify 빌더는 fastify를 import하는 후보 파일만 진입점으로 고른다. 없으면 src/server.ts가 선택된다.
import 'fastify';

import { createSupabaseAccessTokenVerifier } from './auth/supabase-access-token-verifier.js';
import { loadEnvironment } from './config/environment.js';
import { createJobRepository } from './jobs/job-repository.js';
import { buildServer } from './server.js';
import { createUploadGrantIssuer } from './uploads/upload-grant-issuer.js';

const { supabaseSecretKey, supabaseUrl, uploadGrantSecret, workerApiToken, workerReceiverOrigin } =
  loadEnvironment();
const host = process.env.ECHONOTE_BIND_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.ECHONOTE_GATEWAY_PORT ?? '4317', 10);
// Supabase 대시보드 JWT Signing Keys의 Current key 알고리즘과 같아야 한다.
const verifier = createSupabaseAccessTokenVerifier({ algorithms: ['ES256'], supabaseUrl });
const jobRepository = createJobRepository({
  secretKey: supabaseSecretKey,
  supabaseUrl,
  timeoutMs: 5000,
});
const issueUploadGrant = createUploadGrantIssuer({
  receiverOrigin: workerReceiverOrigin,
  secret: uploadGrantSecret,
});
const server = buildServer({
  issueUploadGrant,
  jobRepository,
  logger: true,
  verifier,
  workerApiToken,
});

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

// Vercel은 listen을 가로채고 완료를 알리지 않는다. await하면 모듈 로드가 끝나지 않아 요청이 멈춘다.
server.listen({ host, port }).catch((error: unknown) => {
  server.log.error(error);
  process.exitCode = 1;
});
