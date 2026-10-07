import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, fs, saveFileAsync } = vi.hoisted(() => {
  const calls: string[] = [];
  const fs = {
    directoryExists: false,
    deleteError: null as Error | null,
    copyResult: Promise.resolve() as Promise<void>,
  };

  return {
    calls,
    fs,
    saveFileAsync: vi.fn(async (uri: string, _mimeType: string): Promise<'saved' | 'cancelled'> => {
      calls.push(`save ${uri}`);

      return 'saved';
    }),
  };
});

vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;

    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}${name}/`;
    }

    get exists() {
      return fs.directoryExists;
    }

    delete() {
      calls.push(`delete ${this.uri}`);

      const error = fs.deleteError;

      fs.deleteError = null;

      if (error) throw error;

      fs.directoryExists = false;
    }

    create() {
      calls.push(`create ${this.uri}`);
      fs.directoryExists = true;
    }
  }

  class File {
    uri: string;

    constructor(parentOrUri: { uri: string } | string, name?: string) {
      this.uri = typeof parentOrUri === 'string' ? parentOrUri : `${parentOrUri.uri}${name}`;
    }

    create() {
      calls.push(`create ${this.uri}`);
    }

    write(text: string) {
      calls.push(`write ${this.uri} ${text}`);
    }

    delete() {
      calls.push(`delete ${this.uri}`);
    }

    async copy(destination: { uri: string }) {
      calls.push(`copy ${this.uri} -> ${destination.uri}`);
      await fs.copyResult;
    }
  }

  return { Directory, File, Paths: { cache: { uri: 'file:///cache/' } } };
});
vi.mock('../../../../modules/document-saver', () => ({ saveFileAsync }));

const { saveRecordingCopy, saveTextFile } = await import('./export-meeting-file.native');

describe('export-meeting-file', () => {
  beforeEach(() => {
    calls.length = 0;
    fs.directoryExists = false;
    fs.deleteError = null;
    fs.copyResult = Promise.resolve();
    saveFileAsync.mockClear();
  });

  it('txt를 임시 폴더에 쓰고 저장 화면에 넘긴 뒤 폴더를 지운다', async () => {
    await expect(saveTextFile('회의.txt', '[00:00] 안녕\n')).resolves.toBe('saved');

    expect(calls).toEqual([
      'create file:///cache/exports/',
      'create file:///cache/exports/회의.txt',
      'write file:///cache/exports/회의.txt [00:00] 안녕\n',
      'save file:///cache/exports/회의.txt',
      'delete file:///cache/exports/',
    ]);
    expect(saveFileAsync).toHaveBeenCalledWith('file:///cache/exports/회의.txt', 'text/plain');
  });

  it('남아 있던 임시 폴더는 시작할 때 지운다', async () => {
    fs.directoryExists = true;

    await saveTextFile('회의.txt', '');

    expect(calls.slice(0, 2)).toEqual([
      'delete file:///cache/exports/',
      'create file:///cache/exports/',
    ]);
  });

  it('녹음은 원본을 읽기만 하고 copy가 끝난 뒤 사본을 저장 화면에 넘긴다', async () => {
    await saveRecordingCopy('file:///document/recordings/m1.m4a', '회의.m4a');

    expect(calls).toEqual([
      'create file:///cache/exports/',
      'copy file:///document/recordings/m1.m4a -> file:///cache/exports/회의.m4a',
      'save file:///cache/exports/회의.m4a',
      'delete file:///cache/exports/',
    ]);
    expect(saveFileAsync).toHaveBeenCalledWith('file:///cache/exports/회의.m4a', 'audio/mp4');
  });

  it('copy가 거절되면 저장 화면을 띄우지 않고 거절하며 폴더는 지운다', async () => {
    fs.copyResult = Promise.reject(new Error('missing'));

    await expect(saveRecordingCopy('file:///gone.m4a', '회의.m4a')).rejects.toThrow('missing');
    expect(saveFileAsync).not.toHaveBeenCalled();
    expect(calls.at(-1)).toBe('delete file:///cache/exports/');
  });

  it('저장 화면에서 취소하면 cancelled를 돌려주고 폴더를 지운다', async () => {
    saveFileAsync.mockResolvedValueOnce('cancelled');

    await expect(saveTextFile('회의.txt', '')).resolves.toBe('cancelled');
    expect(calls.at(-1)).toBe('delete file:///cache/exports/');
  });

  it('내보내기가 진행 중이면 두 번째 요청은 사본을 건드리지 않고 거절한다', async () => {
    let finishCopy: () => void = () => {};

    fs.copyResult = new Promise((resolve) => {
      finishCopy = resolve;
    });

    const first = saveRecordingCopy('file:///document/recordings/m1.m4a', '회의.m4a');

    await expect(saveTextFile('회의.txt', '')).rejects.toThrow('export already in progress');
    expect(calls).toEqual([
      'create file:///cache/exports/',
      'copy file:///document/recordings/m1.m4a -> file:///cache/exports/회의.m4a',
    ]);

    finishCopy();

    await expect(first).resolves.toBe('saved');
    await expect(saveTextFile('회의.txt', '')).resolves.toBe('saved');
  });

  it('임시 폴더를 지우지 못해도 저장 결과를 돌려주고 다음 내보내기는 막히지 않는다', async () => {
    fs.deleteError = new Error('busy');

    await expect(saveTextFile('회의.txt', '')).resolves.toBe('saved');
    await expect(saveTextFile('회의.txt', '')).resolves.toBe('saved');
    expect(calls.filter((call) => call.startsWith('delete'))).toHaveLength(3);
  });

  it('저장이 거절돼도 폴더를 지운다', async () => {
    saveFileAsync.mockRejectedValueOnce(new Error('save'));

    await expect(saveTextFile('회의.txt', '')).rejects.toThrow('save');
    expect(calls.at(-1)).toBe('delete file:///cache/exports/');
  });
});
