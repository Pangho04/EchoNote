import { MAX_UPLOAD_BYTES } from '@echonote/contracts';

import type { Recording } from '@/entities/recording';
import type { TranscriptionErrorCode, TranscriptionRepository } from '@/entities/transcript';
import { UI_STRINGS } from '@/shared/config/ui-strings';

import type { TranscriptionGateway } from '../api/transcription-gateway';
import type { UploadRecording } from '../api/upload-recording';

export type RequestTranscriptionDeps = {
  transcriptions: TranscriptionRepository;
  gateway: TranscriptionGateway;
  checkDesktopLive: (uploadUrl: string) => Promise<boolean>;
  uploadRecording: UploadRecording;
  createIdempotencyKey: () => string;
};

// 흐름 중 화면 상태를 묻고 진행을 알린다. 확인 지점마다 그 순간 값을 읽는다.
export type UploadProgressPort = {
  isScreenOpen: () => boolean;
  isInBackground: () => boolean;
  onJobCreated: (jobId: string) => void;
  onUploadStarted: (abort: AbortController) => void;
  onProgress: (percent: number) => void;
};

// row-changed는 다른 화면이 행을 먼저 바꿔 쓰기가 0행이었다는 뜻이다. 호출자가 행을 다시 읽는다.
// stopped는 화면이 닫혔거나 background라 팝업 없이 멈춘 경우다.
export type UploadOutcome =
  | { kind: 'uploaded' }
  | { kind: 'invalid-recording' }
  | { kind: 'create-failed' }
  | { kind: 'grant-failed' }
  | { kind: 'job-missing' }
  | { kind: 'desktop-offline'; jobId: string }
  | { kind: 'upload-failed' }
  | { kind: 'recording-rejected' }
  | { kind: 'aborted' }
  | { kind: 'stopped' }
  | { kind: 'row-changed' };

function canContinue(port: UploadProgressPort): boolean {
  return port.isScreenOpen() && !port.isInBackground();
}

// 3~5단계. [다시 업로드]·깨우기 [다시 확인]은 새 job 없이 여기서 시작한다.
export async function uploadToDesktop(
  deps: RequestTranscriptionDeps,
  port: UploadProgressPort,
  input: { recording: Recording; jobId: string },
): Promise<UploadOutcome> {
  const { recording, jobId } = input;
  const grant = await deps.gateway.issueUploadGrant(jobId);

  if (!port.isScreenOpen()) return { kind: 'stopped' };

  switch (grant.kind) {
    case 'ok':
      break;

    case 'http-error':
      if (grant.status === 409 && grant.error === 'job_not_uploadable') return { kind: 'uploaded' };

      if (grant.status === 404) {
        const deleted = await deps.transcriptions.delete(recording.meetingId, jobId);

        return deleted ? { kind: 'job-missing' } : { kind: 'row-changed' };
      }

      return { kind: 'grant-failed' };

    case 'network-error':
    case 'invalid-response':
    case 'aborted':
      return { kind: 'grant-failed' };
  }

  const isLive = await deps.checkDesktopLive(grant.data.uploadUrl);

  // 꺼진 데스크탑은 화면 상태와 무관하게 desktop-offline이다. 팝업 여부는 호출자가 정한다.
  if (!isLive) return { kind: 'desktop-offline', jobId };

  if (!canContinue(port)) return { kind: 'stopped' };

  const abort = new AbortController();

  port.onUploadStarted(abort);

  const upload = await deps.uploadRecording({
    fileUri: recording.uri,
    uploadUrl: grant.data.uploadUrl,
    grant: grant.data.grant,
    signal: abort.signal,
    onProgress: port.onProgress,
  });

  switch (upload.kind) {
    case 'uploaded':
      return { kind: 'uploaded' };

    case 'recording-rejected': {
      const deleted = await deps.transcriptions.delete(recording.meetingId, jobId);

      return deleted ? { kind: 'recording-rejected' } : { kind: 'row-changed' };
    }

    case 'failed':
      return { kind: 'upload-failed' };

    case 'aborted':
      return { kind: 'aborted' };
  }
}

// 1단계 조건. 어기는 녹음은 job을 만들지 않는다.
export function isTranscribable(recording: Recording): boolean {
  return recording.byteSize <= MAX_UPLOAD_BYTES && recording.mimeType === 'audio/mp4';
}

// 1~5단계. [텍스트로 변환]·[다시 시도]는 새 job부터 만든다.
export async function requestTranscription(
  deps: RequestTranscriptionDeps,
  port: UploadProgressPort,
  recording: Recording,
): Promise<UploadOutcome> {
  if (!isTranscribable(recording)) return { kind: 'invalid-recording' };

  const job = await deps.gateway.createJob(recording, deps.createIdempotencyKey());

  if (!port.isScreenOpen()) return { kind: 'stopped' };

  if (job.kind !== 'ok') return { kind: 'create-failed' };

  const created = await deps.transcriptions.upsertCreated(recording.meetingId, job.data.id);

  if (!created) return { kind: 'row-changed' };

  port.onJobCreated(job.data.id);

  if (!port.isScreenOpen()) return { kind: 'stopped' };

  return uploadToDesktop(deps, port, { recording, jobId: job.data.id });
}

// 서버가 이유를 남기지 않은 실패(null)는 알 수 없는 오류로 보여 준다.
export function toFailureMessage(errorCode: TranscriptionErrorCode | null): string {
  return UI_STRINGS.transcription.failure[errorCode ?? 'unexpected'];
}
