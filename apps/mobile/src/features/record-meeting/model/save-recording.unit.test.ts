import { describe, expect, it, vi } from 'vitest';

import type { MeetingRecordingPersistence } from '@/entities/recording';
import type { Recording } from '@/entities/recording';

import type { RecordingFileService } from '../api/recording-file-service-contract';
import type { SaveRecordingDependencies } from './save-recording';
import {
  isAllowedRecordingMimeType,
  RecordingAlreadySavedError,
  RecordingSourceMissingError,
  saveRecording,
  UnsupportedRecordingMimeError,
} from './save-recording';

const allowedMime = 'audio/mp4';
const disallowedMime = 'video/mp4';

const identity = { byteSize: 2048, mimeType: allowedMime, sha256: 'abc123def456' };

function makeFiles(overrides: Partial<RecordingFileService> = {}): RecordingFileService {
  return {
    // temp는 존재, final은 아직 없음으로 기본값을 둔다.
    exists: vi.fn(async (uri: string) => uri.startsWith('file:///temp/')),
    inspect: vi.fn(async () => identity),
    move: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SaveRecordingDependencies> = {}): SaveRecordingDependencies {
  const persistence: MeetingRecordingPersistence = {
    saveMeetingWithRecording: vi.fn(async () => undefined),
  };

  return {
    persistence,
    files: makeFiles(),
    createFinalUri: (meetingId: string) => `file:///final/${meetingId}.m4a`,
    isAllowedMimeType: isAllowedRecordingMimeType,
    ...overrides,
  };
}

const meeting = {
  meetingId: 'meeting-1',
  title: '제품 회의',
  createdAt: '2026-08-08T00:11:00.000Z',
};

const candidate = { tempUri: 'file:///temp/meeting-1.m4a', durationMs: 12_345 };

describe('isAllowedRecordingMimeType', () => {
  it('audio/mp4만 허용하고 그 외는 거부한다', () => {
    expect(isAllowedRecordingMimeType('audio/mp4')).toBe(true);
    expect(isAllowedRecordingMimeType('video/mp4')).toBe(false);
    expect(isAllowedRecordingMimeType('audio/m4a')).toBe(false);
  });
});

describe('saveRecording', () => {
  it('검증·이동·저장이 순서대로 진행되고 검증된 값만 저장한다', async () => {
    const deps = makeDeps();

    const result = await saveRecording(deps, { meeting, candidate });

    expect(deps.files.move).toHaveBeenCalledWith({
      from: candidate.tempUri,
      to: deps.createFinalUri(meeting.meetingId),
    });
    expect(deps.persistence.saveMeetingWithRecording).toHaveBeenCalledWith({
      meeting,
      recording: {
        meetingId: meeting.meetingId,
        uri: deps.createFinalUri(meeting.meetingId),
        mimeType: allowedMime,
        sha256: identity.sha256,
        durationMs: candidate.durationMs,
        byteSize: identity.byteSize,
      },
    });
    expect(result).toEqual({
      meetingId: meeting.meetingId,
      uri: deps.createFinalUri(meeting.meetingId),
      mimeType: allowedMime,
      sha256: identity.sha256,
      durationMs: candidate.durationMs,
      byteSize: identity.byteSize,
    } satisfies Recording);
  });

  it('temp 원본이 없으면 이동·저장 없이 명시 오류를 던진다', async () => {
    const deps = makeDeps({ files: makeFiles({ exists: vi.fn(async () => false) }) });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toBeInstanceOf(
      RecordingSourceMissingError,
    );
    expect(deps.files.move).not.toHaveBeenCalled();
    expect(deps.persistence.saveMeetingWithRecording).not.toHaveBeenCalled();
  });

  it('MIME 불허면 이동·DB 저장 없이 오류로 끝나고 temp를 보존한다', async () => {
    const deps = makeDeps({
      files: makeFiles({ inspect: vi.fn(async () => ({ ...identity, mimeType: disallowedMime })) }),
    });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toBeInstanceOf(
      UnsupportedRecordingMimeError,
    );
    expect(deps.files.move).not.toHaveBeenCalled();
    expect(deps.persistence.saveMeetingWithRecording).not.toHaveBeenCalled();
  });

  it('이미 저장된 meetingId는 final 존재를 확인하고 이동 없이 중단한다', async () => {
    const deps = makeDeps({ files: makeFiles({ exists: vi.fn(async () => true) }) });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toBeInstanceOf(
      RecordingAlreadySavedError,
    );
    expect(deps.files.move).not.toHaveBeenCalled();
    expect(deps.persistence.saveMeetingWithRecording).not.toHaveBeenCalled();
  });

  it('이동이 실패하면 DB 저장을 실행하지 않고 에러를 전파한다', async () => {
    const moveError = new Error('move failed');
    const deps = makeDeps({
      files: makeFiles({
        move: vi.fn(async () => {
          throw moveError;
        }),
      }),
    });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toThrow('move failed');
    expect(deps.persistence.saveMeetingWithRecording).not.toHaveBeenCalled();
  });

  it('DB 저장이 실패하면 final을 temp로 되돌린 뒤 에러를 전파한다', async () => {
    const dbError = new Error('db failed');
    const deps = makeDeps({
      persistence: {
        saveMeetingWithRecording: vi.fn(async () => {
          throw dbError;
        }),
      },
    });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toThrow('db failed');
    expect(deps.files.move).toHaveBeenLastCalledWith({
      from: deps.createFinalUri(meeting.meetingId),
      to: candidate.tempUri,
    });
  });

  it('복구 이동마저 실패해도 원인인 DB 에러를 삼키지 않는다', async () => {
    const dbError = new Error('db failed');
    const rollbackError = new Error('rollback failed');
    const files = makeFiles();
    vi.mocked(files.move)
      .mockResolvedValueOnce(undefined) // temp → final
      .mockRejectedValueOnce(rollbackError); // final → temp 복구 실패
    const deps = makeDeps({
      files,
      persistence: {
        saveMeetingWithRecording: vi.fn(async () => {
          throw dbError;
        }),
      },
    });

    await expect(saveRecording(deps, { meeting, candidate })).rejects.toThrow('db failed');
  });
});
