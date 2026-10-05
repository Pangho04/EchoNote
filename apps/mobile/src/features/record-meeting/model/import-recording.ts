import { MAX_UPLOAD_BYTES } from '@echonote/contracts';

import type { Recording } from '@/entities/recording/model/recording';

import {
  detectMimeTypeFromBytes,
  type RecordingFileService,
} from '../api/recording-file-service-contract';
import {
  RecordingAlreadySavedError,
  saveRecording,
  type SaveRecordingDependencies,
} from './save-recording';

// m4a 형식 표지(ftyp)는 앞 12바이트 안에 있다.
const HEADER_BYTE_LENGTH = 12;

// ponytail: 고정 10초. 긴 파일의 길이 읽기가 이보다 오래 걸리면 실기기 측정으로 조정한다.
const DURATION_TIMEOUT_MS = 10_000;

// size 0은 picker가 크기를 알려 주지 않은 경우다.
export type CachedRecording = {
  uri: string;
  size: number;
};

// name은 확장자를 포함한 원본 파일 이름이다. 회의 이름의 바탕이 된다.
export type PickedRecording = CachedRecording & {
  name: string;
};

export interface RecordingImportService {
  pickRecording(): Promise<PickedRecording | null>;
  copyToCache(input: { sourceUri: string; meetingId: string }): Promise<CachedRecording>;
  readHeaderBytes(uri: string, length: number): Promise<Uint8Array>;
  readDurationMs(uri: string, timeoutMs: number): Promise<number>;
}

export type ImportFailure = { kind: 'tooLarge' | 'unsupported' | 'unreadable' | 'failed' };

export type ImportResult = { kind: 'saved'; recording: Recording } | ImportFailure;

export type ImportRecordingInput = {
  meetingId: string;
  title: string;
  createdAt: string;
  source: PickedRecording;
};

export type ImportRecordingDependencies = SaveRecordingDependencies & {
  importer: Pick<RecordingImportService, 'copyToCache' | 'readHeaderBytes' | 'readDurationMs'>;
  // iOS picker는 앱 안 임시 사본을 준다. Android content:// 주소는 사용자 원본이라 false여야 한다.
  isPickedSourceAppCopy: boolean;
};

async function deleteQuietly(files: RecordingFileService, uri: string): Promise<void> {
  try {
    await files.delete(uri);
  } catch {
    // 정리 실패는 결과를 바꾸지 않는다.
  }
}

// 고른 파일을 앱 cache로 복사해 검사한 뒤 녹음과 같은 저장 경로로 회의를 만든다.
// 사용자 원본은 어떤 경우에도 지우지 않는다. 모든 오류를 kind로 바꾸고 reject하지 않는다.
export async function importRecording(
  deps: ImportRecordingDependencies,
  input: ImportRecordingInput,
): Promise<ImportResult> {
  let copy: CachedRecording;

  try {
    copy = await deps.importer.copyToCache({
      sourceUri: input.source.uri,
      meetingId: input.meetingId,
    });
  } catch {
    return { kind: 'failed' };
  } finally {
    if (deps.isPickedSourceAppCopy) await deleteQuietly(deps.files, input.source.uri);
  }

  const failWith = async (kind: ImportFailure['kind']): Promise<ImportFailure> => {
    await deleteQuietly(deps.files, copy.uri);

    return { kind };
  };

  if (copy.size > MAX_UPLOAD_BYTES) return failWith('tooLarge');

  let durationMs: number;

  try {
    const header = await deps.importer.readHeaderBytes(copy.uri, HEADER_BYTE_LENGTH);

    if (!deps.isAllowedMimeType(detectMimeTypeFromBytes(header))) return failWith('unsupported');
  } catch {
    return failWith('unsupported');
  }

  try {
    durationMs = await deps.importer.readDurationMs(copy.uri, DURATION_TIMEOUT_MS);
  } catch {
    return failWith('unreadable');
  }

  try {
    const recording = await saveRecording(deps, {
      meeting: { meetingId: input.meetingId, title: input.title, createdAt: input.createdAt },
      candidate: { tempUri: copy.uri, durationMs },
    });

    return { kind: 'saved', recording };
  } catch (error) {
    const finalUri = deps.createFinalUri(input.meetingId);

    // meetingId가 새 값이라 final은 이번 가져오기가 옮긴 사본뿐이다. 원본은 기기에 남아 있다.
    if (
      !(error instanceof RecordingAlreadySavedError) &&
      (await deps.files.exists(finalUri).catch(() => false))
    ) {
      await deleteQuietly(deps.files, finalUri);
    }

    return failWith('failed');
  }
}
