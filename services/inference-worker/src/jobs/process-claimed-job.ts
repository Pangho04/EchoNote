import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobSnapshot, TranscriptResult } from '@echonote/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { ParsedTranscript } from '../stt/parse-whisper-output.js';

type ClaimedJobProcessorOptions = {
  dataDir: string;
  logger: Pick<FastifyBaseLogger, 'info'>;
  transcribe: (jobId: string, signal: AbortSignal) => Promise<ParsedTranscript>;
};

// receiveUpload가 final/<jobId>.m4a로 확정한 파일을 전사한다. 로그에는 개수·길이만 남긴다.
export const createClaimedJobProcessor = ({
  dataDir,
  logger,
  transcribe,
}: ClaimedJobProcessorOptions) => {
  return async (job: JobSnapshot, signal: AbortSignal): Promise<TranscriptResult> => {
    // 오류를 감싸지 않는다. runner가 code만 로그로 남긴다.
    await stat(join(dataDir, 'final', `${job.id}.m4a`));

    const { durationMs, segments } = await transcribe(job.id, signal);

    logger.info({ durationMs, jobId: job.id, segmentCount: segments.length }, 'job transcribed');

    // schemaVersion은 컨테이너 출력 형식이라 Gateway로 보내지 않는다.
    return { durationMs, segments };
  };
};
