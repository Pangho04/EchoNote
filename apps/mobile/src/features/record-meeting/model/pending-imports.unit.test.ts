import { describe, expect, it, vi } from 'vitest';

import type { ImportResult } from './import-recording';
import { createPendingImports } from './pending-imports';

function deferred() {
  let resolve!: (result: ImportResult) => void;
  const promise = new Promise<ImportResult>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const createdAt = '2026-10-03T00:00:00.000Z';

describe('createPendingImports', () => {
  it('settle 뒤에도 consume 전까지 get으로 결과를 돌려준다', async () => {
    const imports = createPendingImports();

    imports.start('m1', {
      title: '회의',
      createdAt,
      importRecording: async () => ({ kind: 'tooLarge' }),
    });

    await expect(imports.get('m1')?.result).resolves.toEqual({ kind: 'tooLarge' });
    expect(imports.get('m1')).toMatchObject({ title: '회의', createdAt });

    imports.consume('m1');
    imports.consume('m1');

    expect(imports.get('m1')).toBeUndefined();
  });

  it('한 번에 1건씩 start 순서대로 실행한다', async () => {
    const imports = createPendingImports();
    const first = deferred();
    const second = vi.fn(async (): Promise<ImportResult> => ({ kind: 'failed' }));

    imports.start('m1', { title: '첫째', createdAt, importRecording: () => first.promise });
    imports.start('m2', { title: '둘째', createdAt, importRecording: second });
    await Promise.resolve();

    expect(second).not.toHaveBeenCalled();

    first.resolve({ kind: 'unsupported' });
    await imports.get('m2')?.result;

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reject는 failed로 바꾸고 다음 가져오기를 막지 않는다', async () => {
    const imports = createPendingImports();

    imports.start('m1', {
      title: '첫째',
      createdAt,
      importRecording: async () => Promise.reject(new Error('x')),
    });
    imports.start('m2', {
      title: '둘째',
      createdAt,
      importRecording: async () => ({ kind: 'unreadable' }),
    });

    await expect(imports.get('m1')?.result).resolves.toEqual({ kind: 'failed' });
    await expect(imports.get('m2')?.result).resolves.toEqual({ kind: 'unreadable' });
  });

  it('failures()는 settle된 실패만 start 순서로 주고, listener 안에서 방금 실패가 보인다', async () => {
    const imports = createPendingImports();
    const pending = deferred();
    const seen: string[][] = [];

    imports.subscribe(() => seen.push(imports.failures().map((failure) => failure.meetingId)));
    imports.start('m1', {
      title: '실패1',
      createdAt,
      importRecording: async () => ({ kind: 'tooLarge' }),
    });
    imports.start('m2', { title: '진행', createdAt, importRecording: () => pending.promise });
    await imports.get('m1')?.result;
    await Promise.resolve();

    expect(seen).toEqual([['m1']]);
    expect(imports.failures()).toEqual([
      { meetingId: 'm1', title: '실패1', result: { kind: 'tooLarge' } },
    ]);

    pending.resolve({ kind: 'failed' });
    await imports.get('m2')?.result;
    await Promise.resolve();

    expect(seen.at(-1)).toEqual(['m1', 'm2']);
  });

  it('saved는 failures()에 넣지 않고, unsubscribe 뒤에는 알리지 않는다', async () => {
    const imports = createPendingImports();
    const listener = vi.fn();
    const unsubscribe = imports.subscribe(listener);

    unsubscribe();
    imports.start('m1', {
      title: '성공',
      createdAt,
      importRecording: async () => ({ kind: 'saved', recording: {} as never }),
    });
    await imports.get('m1')?.result;
    await Promise.resolve();

    expect(imports.failures()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});
