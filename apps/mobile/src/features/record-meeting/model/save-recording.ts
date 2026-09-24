import type { MeetingRecordingPersistence } from '@/entities/recording/api/recording-persistence';
import type { Recording } from '@/entities/recording/model/recording';
import { CodedError } from '@/shared/lib/coded-error';

import type { RecordingFileService } from '../api/recording-file-service-contract';
import type { StoppedRecordingCandidate } from '../api/recording-service-contract';

// MIME allowlist는 audio/mp4 단독이다. 이 목록 밖은 저장 전 어떤 mutation도 하지 않는다.
export const RECORDING_MIME_ALLOWLIST: readonly string[] = ['audio/mp4'];

export function isAllowedRecordingMimeType(mimeType: string): boolean {
  return RECORDING_MIME_ALLOWLIST.includes(mimeType);
}

export class RecordingSourceMissingError extends CodedError {
  readonly code = 'RECORDING_SOURCE_MISSING' as const;

  constructor() {
    super('저장할 녹음 원본 파일을 찾을 수 없습니다.');
  }
}

export class UnsupportedRecordingMimeError extends CodedError {
  readonly code = 'UNSUPPORTED_RECORDING_MIME' as const;

  constructor(mimeType: string) {
    super(`지원하지 않는 녹음 형식입니다: ${mimeType}`);
  }
}

export class RecordingAlreadySavedError extends CodedError {
  readonly code = 'RECORDING_ALREADY_SAVED' as const;

  constructor() {
    super('이미 저장된 회의 녹음이 있어 덮어쓰지 않습니다.');
  }
}

export type SaveRecordingInput = {
  meeting: {
    meetingId: string;
    title: string;
    createdAt: string;
  };
  candidate: StoppedRecordingCandidate;
};

export type SaveRecordingDependencies = {
  persistence: Pick<MeetingRecordingPersistence, 'saveMeetingWithRecording'>;
  files: RecordingFileService;
  createFinalUri: (meetingId: string) => string;
  isAllowedMimeType: (mimeType: string) => boolean;
};

// stop 뒤 temp 원본을 검증·이동하고 Meeting+Recording 1:1 pair를 한 transaction으로 저장한다.
// 어떤 실패에서도 확인되지 않은 원본을 삭제하지 않는다.
export async function saveRecording(
  deps: SaveRecordingDependencies,
  input: SaveRecordingInput,
): Promise<Recording> {
  const tempUri = input.candidate.tempUri;
  const finalUri = deps.createFinalUri(input.meeting.meetingId);

  if (!(await deps.files.exists(tempUri))) {
    throw new RecordingSourceMissingError();
  }

  // temp 파일 byte를 한 번 읽어 정체성(byteSize·MIME·SHA-256)을 확정한다.
  const identity = await deps.files.inspect(tempUri);

  // MIME 검증을 통과하기 전에는 어떤 mutation도 하지 않는다.
  if (!deps.isAllowedMimeType(identity.mimeType)) {
    throw new UnsupportedRecordingMimeError(identity.mimeType);
  }

  // 같은 meetingId로 이미 저장된 회의면 final이 존재한다. canonical 원본을
  // 덮어쓰지 않도록 이동을 시작하지 않고 중단한다.
  if (await deps.files.exists(finalUri)) {
    throw new RecordingAlreadySavedError();
  }

  // temp → final 이동. 실패하면 DB를 실행하지 않고 temp를 보존한다.
  await deps.files.move({ from: tempUri, to: finalUri });

  const recording: Recording = {
    meetingId: input.meeting.meetingId,
    uri: finalUri,
    mimeType: identity.mimeType,
    sha256: identity.sha256,
    durationMs: input.candidate.durationMs,
    byteSize: identity.byteSize,
  };

  try {
    await deps.persistence.saveMeetingWithRecording({ meeting: input.meeting, recording });
  } catch (error) {
    // DB 실패면 final을 temp 위치로 되돌린다. 복구 이동마저 실패해도 원인인
    // DB 에러를 삼키지 않고 그대로 전파한다(원본은 어느 쪽에도 남는다).
    try {
      await deps.files.move({ from: finalUri, to: tempUri });
    } catch {
      // 보존용: DB 에러가 최우선이므로 무시한다.
    }

    throw error;
  }

  return recording;
}
