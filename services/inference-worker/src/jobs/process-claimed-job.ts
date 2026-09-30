import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobSnapshot } from '@echonote/contracts';

// receiveUpload가 final/<jobId>.m4a로 확정한 파일을 처리한다.
// ponytail: 파일이 있는지만 확인한다. STT를 붙일 때 signal로 중단을 받는다.
export const createClaimedJobProcessor = (dataDir: string) => async (job: JobSnapshot) => {
  // 오류를 감싸지 않는다. runner가 code만 로그로 남긴다.
  await stat(join(dataDir, 'final', `${job.id}.m4a`));
};
