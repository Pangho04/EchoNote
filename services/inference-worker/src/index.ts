import { join } from 'node:path';

import { loadEnvironment } from './config/environment.js';
import { createJobLeaseClient } from './jobs/job-lease-client.js';
import { startJobRunner } from './jobs/job-runner.js';
import { createClaimedJobProcessor } from './jobs/process-claimed-job.js';
import { buildServer } from './server.js';
import { type NonceStore, openNonceStore } from './uploads/nonce-store.js';
import { prepareUploadDirectories } from './uploads/receive-upload.js';
import { createUploadCompletionClient } from './uploads/upload-completion-client.js';
import { createUploadGrantVerifier } from './uploads/upload-grant-verifier.js';

// Tailscale Serve만 이 포트에 접근한다. tailnet이나 외부 주소에 직접 bind하지 않는다.
const HOST = '127.0.0.1';

const { dataDir, gatewayOrigin, port, uploadGrantSecret, workerApiToken } = loadEnvironment();

let nonceStore: NonceStore;

try {
  await prepareUploadDirectories(dataDir);
  nonceStore = openNonceStore(join(dataDir, 'nonces.sqlite'));
} catch (error) {
  // fs·sqlite 오류 message에는 데이터 경로가 들어 있으므로 code만 남긴다.
  console.error('worker startup failed', { code: (error as NodeJS.ErrnoException).code });
  process.exit(1);
}

const server = buildServer({
  dataDir,
  logger: true,
  nonceStore,
  notifyUploadCompletion: createUploadCompletionClient({ gatewayOrigin, workerApiToken }),
  verifyGrant: createUploadGrantVerifier({ secret: uploadGrantSecret }),
});

try {
  await server.listen({ host: HOST, port });

  const runner = startJobRunner({
    client: createJobLeaseClient({ gatewayOrigin, workerApiToken }),
    logger: server.log,
    processJob: createClaimedJobProcessor(dataDir),
  });
  let shuttingDown = false;

  // 진행 중 job과 요청이 끝난 뒤 server를 닫는다. 두 번째 이후 신호는 무시한다.
  const shutdown = async () => {
    if (shuttingDown) return;

    shuttingDown = true;

    try {
      await runner.stop();
      await server.close();
      nonceStore.close();
    } catch (error) {
      server.log.error({ code: (error as NodeJS.ErrnoException).code }, 'worker shutdown failed');
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
} catch (error) {
  server.log.error({ code: (error as NodeJS.ErrnoException).code }, 'worker listen failed');
  process.exitCode = 1;
}
