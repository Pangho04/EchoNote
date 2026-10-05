import type { TranscriptionRepository } from '@/entities/transcript';

import type { TranscriptionGateway } from '../api/transcription-gateway';

export type SyncTranscriptionsDeps = {
  transcriptions: TranscriptionRepository;
  gateway: Pick<TranscriptionGateway, 'getJob' | 'getTranscript'>;
};

// 행을 바꿨으면 true다. 쓰기가 0행이어도 다른 화면이 행을 바꾼 것이라 true다.
async function syncTranscription(
  deps: SyncTranscriptionsDeps,
  meetingId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const stored = await deps.transcriptions.get(meetingId);

  if (stored.kind !== 'row') return false;

  const { status, jobId } = stored.transcription;

  if (status !== 'queued' && status !== 'processing') return false;

  const result = await deps.gateway.getJob(meetingId, jobId, signal);

  switch (result.kind) {
    case 'ok':
      break;

    // 서버에 작업이 없으면 상세와 같이 행을 지워 요청 전 상태로 돌린다.
    case 'http-error':
      if (result.status !== 404) return false;

      await deps.transcriptions.delete(meetingId, jobId);

      return true;

    // 응답을 쓸 수 없으면 행을 두고 다음 회차에 다시 묻는다. 손상 응답 안내는 상세가 맡는다.
    case 'network-error':
    case 'invalid-response':
    case 'aborted':
      return false;
  }

  const job = result.data;

  switch (job.status) {
    case 'created':
    case 'queued':
    case 'processing':
      if (job.status === status) return false;

      await deps.transcriptions.updateStatus(meetingId, jobId, job.status, null);

      return true;

    case 'failed':
      await deps.transcriptions.updateStatus(meetingId, jobId, 'failed', job.errorCode);

      return true;

    case 'completed': {
      const transcript = await deps.gateway.getTranscript(jobId, signal);

      // 본문을 받지 못하면 진행 중 행을 두고 다음 회차에 다시 받는다.
      if (transcript.kind !== 'ok') return false;

      await deps.transcriptions.saveCompleted(meetingId, jobId, transcript.data);

      return true;
    }
  }
}

// 대기·변환 중 회의의 서버 상태를 앱 저장소에 옮긴다. 상세를 열지 않아도 목록 뱃지가 바뀐다.
// 하나라도 행이 바뀌었으면 true다. 한 회의의 실패는 건너뛰고 다음 회의를 묻는다.
export async function syncPendingTranscriptions(
  deps: SyncTranscriptionsDeps,
  meetingIds: readonly string[],
  signal: AbortSignal,
): Promise<boolean> {
  let changed = false;

  // ponytail: 회의마다 순차 조회. 진행 중 회의가 많아지면 Gateway에 묶음 조회 API를 둔다.
  for (const meetingId of meetingIds) {
    if (signal.aborted) break;

    try {
      if (await syncTranscription(deps, meetingId, signal)) changed = true;
    } catch {
      // 저장소·네트워크 예외는 이번 회차만 건너뛴다.
    }
  }

  return changed;
}
