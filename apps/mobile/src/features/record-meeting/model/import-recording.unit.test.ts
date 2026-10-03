import { describe, expect, it, vi } from 'vitest';

import type { RecordingFileService } from '../api/recording-file-service-contract';
import {
  importRecording,
  type ImportRecordingDependencies,
  type RecordingImportService,
} from './import-recording';
import { isAllowedRecordingMimeType } from './save-recording';

const sourceUri = 'file:///picked/source.m4a';
const copyUri = 'file:///cache/meeting-1.m4a';
const finalUri = 'file:///final/meeting-1.m4a';

const m4aHeader = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypM4A ')]);
const textHeader = new TextEncoder().encode('hello world!');

function makeImporter(
  overrides: Partial<ImportRecordingDependencies['importer']> = {},
): Pick<RecordingImportService, 'copyToCache' | 'readHeaderBytes' | 'readDurationMs'> {
  return {
    copyToCache: vi.fn(async () => ({ uri: copyUri, size: 2048 })),
    readHeaderBytes: vi.fn(async () => m4aHeader),
    readDurationMs: vi.fn(async () => 12_345),
    ...overrides,
  };
}

function makeFiles(overrides: Partial<RecordingFileService> = {}): RecordingFileService {
  const present = new Set([sourceUri, copyUri]);

  return {
    exists: vi.fn(async (uri: string) => present.has(uri)),
    inspect: vi.fn(async () => ({ byteSize: 2048, mimeType: 'audio/mp4', sha256: 'abc' })),
    move: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      present.delete(from);
      present.add(to);
    }),
    delete: vi.fn(async (uri: string) => {
      present.delete(uri);
    }),
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<ImportRecordingDependencies> = {},
): ImportRecordingDependencies {
  return {
    persistence: { saveMeetingWithRecording: vi.fn(async () => undefined) },
    files: makeFiles(),
    createFinalUri: () => finalUri,
    isAllowedMimeType: isAllowedRecordingMimeType,
    importer: makeImporter(),
    isPickedSourceAppCopy: false,
    ...overrides,
  };
}

const input = {
  meetingId: 'meeting-1',
  title: '가져온 회의',
  createdAt: '2026-10-03T00:00:00.000Z',
  source: { uri: sourceUri, size: 2048 },
};

function deletedUris(deps: ImportRecordingDependencies): string[] {
  return vi.mocked(deps.files.delete).mock.calls.map(([uri]) => uri);
}

describe('importRecording', () => {
  it('사본을 검사해 final로 옮기고 회의를 저장한다', async () => {
    const deps = makeDeps();

    const result = await importRecording(deps, input);

    expect(result).toMatchObject({
      kind: 'saved',
      recording: { uri: finalUri, durationMs: 12_345 },
    });
    expect(deps.files.move).toHaveBeenCalledWith({ from: copyUri, to: finalUri });
    expect(deletedUris(deps)).toEqual([]);
  });

  it('T-I3 사본이 상한을 넘으면 tooLarge로 사본만 지운다', async () => {
    const deps = makeDeps({
      importer: makeImporter({
        copyToCache: vi.fn(async () => ({ uri: copyUri, size: 512 * 1024 * 1024 + 1 })),
      }),
    });

    await expect(importRecording(deps, input)).resolves.toEqual({ kind: 'tooLarge' });
    expect(deletedUris(deps)).toEqual([copyUri]);
    expect(deps.persistence.saveMeetingWithRecording).not.toHaveBeenCalled();
  });

  it('T-I4 m4a 표지가 없거나 헤더를 못 읽으면 unsupported로 사본만 지운다', async () => {
    const wrongHeader = makeDeps({
      importer: makeImporter({ readHeaderBytes: vi.fn(async () => textHeader) }),
    });
    const unreadableHeader = makeDeps({
      importer: makeImporter({
        readHeaderBytes: vi.fn(async () => Promise.reject(new Error('io'))),
      }),
    });

    await expect(importRecording(wrongHeader, input)).resolves.toEqual({ kind: 'unsupported' });
    await expect(importRecording(unreadableHeader, input)).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(deletedUris(wrongHeader)).toEqual([copyUri]);
    expect(deletedUris(unreadableHeader)).toEqual([copyUri]);
  });

  it('T-I5 길이를 못 읽으면 unreadable로 사본만 지운다', async () => {
    const deps = makeDeps({
      importer: makeImporter({
        readDurationMs: vi.fn(async () => Promise.reject(new Error('timeout'))),
      }),
    });

    await expect(importRecording(deps, input)).resolves.toEqual({ kind: 'unreadable' });
    expect(deletedUris(deps)).toEqual([copyUri]);
  });

  it('T-I6 복사가 실패하면 failed로 끝나고 아무것도 지우지 않는다', async () => {
    const deps = makeDeps({
      importer: makeImporter({ copyToCache: vi.fn(async () => Promise.reject(new Error('copy'))) }),
    });

    await expect(importRecording(deps, input)).resolves.toEqual({ kind: 'failed' });
    expect(deletedUris(deps)).toEqual([]);
  });

  it('T-I6 DB 저장이 실패하면 failed로 사본과 이번에 만든 final을 지운다', async () => {
    const deps = makeDeps({
      persistence: { saveMeetingWithRecording: vi.fn(async () => Promise.reject(new Error('db'))) },
    });

    await expect(importRecording(deps, input)).resolves.toEqual({ kind: 'failed' });
    expect(deletedUris(deps)).not.toContain(sourceUri);
    expect(await deps.files.exists(finalUri)).toBe(false);
    expect(await deps.files.exists(copyUri)).toBe(false);
  });

  it('Android 원본은 성공·실패 모두 지우지 않고, iOS 앱 사본은 복사 뒤 지운다', async () => {
    const android = makeDeps({
      importer: makeImporter({ readDurationMs: vi.fn(async () => Promise.reject(new Error('x'))) }),
    });
    const ios = makeDeps({ isPickedSourceAppCopy: true });

    await importRecording(android, input);
    await importRecording(ios, input);

    expect(deletedUris(android)).not.toContain(sourceUri);
    expect(deletedUris(ios)).toEqual([sourceUri]);
  });
});
