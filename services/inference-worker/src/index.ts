import { join } from 'node:path';

import { loadEnvironment } from './config/environment.js';
import { createJobLeaseClient } from './jobs/job-lease-client.js';
import { startJobRunner } from './jobs/job-runner.js';
import { createClaimedJobProcessor } from './jobs/process-claimed-job.js';
import { buildServer } from './server.js';
import {
  checkSttReady,
  codeOf,
  createDockerTranscriber,
  removeStaleSttContainers,
} from './stt/docker-transcriber.js';
import { type NonceStore, openNonceStore } from './uploads/nonce-store.js';
import { prepareUploadDirectories } from './uploads/receive-upload.js';
import { createUploadCompletionClient } from './uploads/upload-completion-client.js';
import { createUploadGrantVerifier } from './uploads/upload-grant-verifier.js';

// Tailscale Serve만 이 포트에 접근한다. tailnet이나 외부 주소에 직접 bind하지 않는다.
const HOST = '127.0.0.1';

const { dataDir, dockerPath, gatewayOrigin, port, uploadGrantSecret, workerApiToken } =
  loadEnvironment();

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

  const startup = new AbortController();
  let runner: ReturnType<typeof startJobRunner> | undefined;
  let shuttingDown = false;

  // 진행 중 job과 요청이 끝난 뒤 server를 닫는다. 두 번째 이후 신호는 무시한다.
  const shutdown = async () => {
    if (shuttingDown) return;

    shuttingDown = true;
    startup.abort();

    try {
      await starting;
      await runner?.stop();
      await server.close();
      nonceStore.close();
    } catch (error) {
      server.log.error({ code: (error as NodeJS.ErrnoException).code }, 'worker shutdown failed');
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // STT를 쓸 수 없어도 업로드 수신은 유지한다. job은 다음 기동 때 처리한다.
  const startStt = async () => {
    const deps = { dataDir, dockerPath, logger: server.log };

    try {
      await removeStaleSttContainers(deps, startup.signal);

      const imageId = await checkSttReady(deps, startup.signal);

      if (shuttingDown) return;

      runner = startJobRunner({
        client: createJobLeaseClient({ gatewayOrigin, workerApiToken }),
        logger: server.log,
        processJob: createClaimedJobProcessor({
          dataDir,
          logger: server.log,
          transcribe: createDockerTranscriber({ ...deps, imageId }),
        }),
      });
    } catch (error) {
      // 종료 신호로 멈춘 확인은 실패가 아니다.
      if (startup.signal.aborted) return;

      server.log.warn({ code: codeOf(error) }, 'stt unavailable');
    }
  };

  const starting = startStt();
} catch (error) {
  server.log.error({ code: (error as NodeJS.ErrnoException).code }, 'worker listen failed');
  process.exitCode = 1;
}
