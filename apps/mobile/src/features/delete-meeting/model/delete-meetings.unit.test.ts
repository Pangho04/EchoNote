import { describe, expect, it, vi } from 'vitest';

import { deleteMeetings, type DeleteMeetingsDependencies } from './delete-meetings';

function makeDeps(overrides: Partial<DeleteMeetingsDependencies> = {}): DeleteMeetingsDependencies {
  return {
    deleteMeetingsWithRecordings: vi.fn(async () => ['file:///a.m4a', 'file:///b.m4a']),
    deleteRecordingFile: vi.fn(),
    ...overrides,
  };
}

describe('deleteMeetings', () => {
  it('DB에서 지운 회의의 녹음 파일을 모두 지운다', async () => {
    const deps = makeDeps();

    await deleteMeetings(deps, ['a', 'b']);

    expect(deps.deleteMeetingsWithRecordings).toHaveBeenCalledWith(['a', 'b']);
    expect(deps.deleteRecordingFile).toHaveBeenCalledWith('file:///a.m4a');
    expect(deps.deleteRecordingFile).toHaveBeenCalledWith('file:///b.m4a');
  });

  it('DB 삭제가 실패하면 파일을 건드리지 않고 에러를 전파한다', async () => {
    const deps = makeDeps({
      deleteMeetingsWithRecordings: vi.fn(async () => {
        throw new Error('db failed');
      }),
    });

    await expect(deleteMeetings(deps, ['a'])).rejects.toThrow('db failed');
    expect(deps.deleteRecordingFile).not.toHaveBeenCalled();
  });

  it('파일 하나를 지우지 못해도 나머지를 지우고 성공한다', async () => {
    const deps = makeDeps({
      deleteRecordingFile: vi.fn((uri: string) => {
        if (uri === 'file:///a.m4a') throw new Error('io');
      }),
    });

    await expect(deleteMeetings(deps, ['a', 'b'])).resolves.toBeUndefined();
    expect(deps.deleteRecordingFile).toHaveBeenCalledWith('file:///b.m4a');
  });
});
