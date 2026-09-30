import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobSnapshot } from '@echonote/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { ParsedTranscript } from '../stt/parse-whisper-output.js';

type ClaimedJobProcessorOptions = {
  dataDir: string;
  logger: Pick<FastifyBaseLogger, 'info'>;
  transcribe: (jobId: string, signal: AbortSignal) => Promise<ParsedTranscript>;
};

// receiveUpload가 final/<jobId>.m4a로 확정한 파일을 전사한다. 결과는 개수·길이만 로그로 남긴다.
export const createClaimedJobProcessor = ({
  dataDir,
  logger,
  transcribe,
}: ClaimedJobProcessorOptions) => {
  // 결과를 영속하지 않아 전사한 job도 lease가 끝나면 다시 claim된다. 같은 프로세스에서는 다시 전사하지 않는다.
  // ponytail: 프로세스 메모리에만 있어 재시작하면 비워진다. 결과를 영속하면 불필요하다.
  const transcribed = new Set<string>();

  return async (job: JobSnapshot, signal: AbortSignal) => {
    if (transcribed.has(job.id)) {
      logger.info({ jobId: job.id }, 'job transcription skipped');

      return;
    }

    // 오류를 감싸지 않는다. runner가 code만 로그로 남긴다.
    await stat(join(dataDir, 'final', `${job.id}.m4a`));

    const { durationMs, segments } = await transcribe(job.id, signal);

    transcribed.add(job.id);
    logger.info({ durationMs, jobId: job.id, segmentCount: segments.length }, 'job transcribed');
  };
};
