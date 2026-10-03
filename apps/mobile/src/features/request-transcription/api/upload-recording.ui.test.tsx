import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { uploadRecording } from './upload-recording';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'keep-awake-tag') }));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const FileMock = File as unknown as jest.Mock;

function mockTask(uploadAsync: () => Promise<{ status: number }>) {
  const task = { uploadAsync: jest.fn(uploadAsync), release: jest.fn() };
  const createUploadTask = jest.fn(() => task);

  FileMock.mockImplementation(() => ({ createUploadTask }));

  return { task, createUploadTask };
}

function input(signal = new AbortController().signal) {
  return {
    fileUri: 'file:///recording.m4a',
    uploadUrl: 'https://desktop.test/u',
    grant: 'g',
    signal,
    onProgress: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('uploadRecording', () => {
  it('foreground PUT으로 보내고 같은 태그로 keep-awake를 켜고 끈다', async () => {
    const { task, createUploadTask } = mockTask(async () => ({ status: 201 }));
    const args = input();

    expect(await uploadRecording(args)).toEqual({ kind: 'uploaded' });
    expect(createUploadTask).toHaveBeenCalledWith(
      'https://desktop.test/u',
      expect.objectContaining({
        httpMethod: 'PUT',
        sessionType: 'foreground',
        headers: { Authorization: 'Bearer g', 'Content-Type': 'application/octet-stream' },
        signal: args.signal,
      }),
    );
    expect(task.release).toHaveBeenCalledTimes(1);
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('keep-awake-tag');
    expect(deactivateKeepAwake).toHaveBeenCalledWith('keep-awake-tag');
  });

  it('진행률을 백분율로 알린다', async () => {
    const { createUploadTask } = mockTask(async () => ({ status: 200 }));
    const args = input();

    await uploadRecording(args);

    const options = (createUploadTask.mock.calls[0] as unknown[])[1] as {
      onProgress: (event: { bytesSent: number; totalBytes: number }) => void;
    };

    options.onProgress({ bytesSent: 1, totalBytes: 3 });
    options.onProgress({ bytesSent: 0, totalBytes: 0 });

    expect(args.onProgress).toHaveBeenCalledTimes(1);
    expect(args.onProgress).toHaveBeenCalledWith(33);
  });

  it.each([
    [422, 'recording-rejected'],
    [500, 'failed'],
    [401, 'failed'],
  ])('%i 응답은 %s다', async (status, kind) => {
    const { task } = mockTask(async () => ({ status }));

    expect(await uploadRecording(input())).toEqual({ kind });
    expect(task.release).toHaveBeenCalledTimes(1);
  });

  it('전송이 reject되면 취소 여부로 aborted·failed를 나누고 keep-awake를 끈다', async () => {
    const abort = new AbortController();
    const { task } = mockTask(async () => {
      abort.abort();
      throw new Error('cancelled');
    });

    expect(await uploadRecording(input(abort.signal))).toEqual({ kind: 'aborted' });
    expect(task.release).toHaveBeenCalledTimes(1);

    mockTask(async () => {
      throw new Error('offline');
    });

    expect(await uploadRecording(input())).toEqual({ kind: 'failed' });
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(2);
  });

  it('작업을 만들다 throw해도 keep-awake를 끈다', async () => {
    FileMock.mockImplementation(() => {
      throw new Error('missing file');
    });

    expect(await uploadRecording(input())).toEqual({ kind: 'failed' });
    expect(deactivateKeepAwake).toHaveBeenCalledWith('keep-awake-tag');
  });

  it('업로드마다 keep-awake 태그가 다르다', async () => {
    const { task } = mockTask(async () => ({ status: 200 }));

    (Crypto.randomUUID as jest.Mock).mockReturnValueOnce('tag-1').mockReturnValueOnce('tag-2');

    await uploadRecording(input());
    await uploadRecording(input());

    expect(activateKeepAwakeAsync).toHaveBeenNthCalledWith(1, 'tag-1');
    expect(activateKeepAwakeAsync).toHaveBeenNthCalledWith(2, 'tag-2');
    expect(task.release).toHaveBeenCalledTimes(2);
  });

  it('keep-awake 켜기가 실패해도 업로드는 진행한다', async () => {
    const { task } = mockTask(async () => ({ status: 200 }));

    (activateKeepAwakeAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));

    expect(await uploadRecording(input())).toEqual({ kind: 'uploaded' });
    expect(task.uploadAsync).toHaveBeenCalledTimes(1);
    expect(deactivateKeepAwake).toHaveBeenCalledWith('keep-awake-tag');
  });
});
