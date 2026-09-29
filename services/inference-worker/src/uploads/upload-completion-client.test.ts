import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUploadCompletionClient } from './upload-completion-client.js';
import { UploadCompletionError } from './upload-completion-error.js';

const GATEWAY_ORIGIN = 'https://gateway.example.test';
const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');

const command = {
  jobId: '00000000-0000-4000-8000-0000000000f1',
  mimeType: 'audio/mp4' as const,
  ownerId: '00000000-0000-4000-8000-00000000000a',
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
};

const notify = createUploadCompletionClient({
  gatewayOrigin: GATEWAY_ORIGIN,
  workerApiToken: WORKER_API_TOKEN,
});

const stubFetch = (implementation: () => Promise<Response>) => {
  const fetchMock = vi.fn(implementation);

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

const captureError = async () => {
  try {
    await notify(command);
  } catch (error) {
    return error as Error;
  }

  throw new Error('notify did not throw');
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createUploadCompletionClient', () => {
  it('Worker token과 command를 담아 완료 통지 route로 POST한다', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 201 }));

    await notify(command);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);

    expect(url.href).toBe(`${GATEWAY_ORIGIN}/v1/worker/upload-completions`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get('authorization')).toBe(`Bearer ${WORKER_API_TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(command);
  });

  it.each([
    [201, 'created'],
    [200, 'existing'],
  ])('%i은 %s다', async (status, result) => {
    stubFetch(async () => new Response('{}', { status }));

    await expect(notify(command)).resolves.toBe(result);
  });

  it.each([302, 400, 401, 404, 409, 502])('%i은 gateway_<status>다', async (status) => {
    stubFetch(async () => new Response(null, { status }));

    const error = await captureError();

    expect(error).toBeInstanceOf(UploadCompletionError);
    expect(error).toMatchObject({ reason: `gateway_${status}` });
  });

  it.each([
    ['TimeoutError', new DOMException('signal timed out', 'TimeoutError'), 'timeout'],
    [
      'TypeError',
      new TypeError('fetch failed', { cause: new Error(`connect ${GATEWAY_ORIGIN}`) }),
      'network',
    ],
  ])('fetch가 %s로 reject하면 %s이고 URL·token을 담지 않는다', async (_label, cause, reason) => {
    stubFetch(async () => {
      throw cause;
    });

    const error = await captureError();

    expect(error).toMatchObject({ reason });
    expect(error.cause).toBeUndefined();
    expect(`${error.message}${error.stack}`).not.toContain(GATEWAY_ORIGIN);
    expect(`${error.message}${error.stack}`).not.toContain(WORKER_API_TOKEN);
  });

  it('분류 밖 예외는 변환하지 않고 그대로 던진다', async () => {
    const unexpected = new RangeError('unexpected');

    stubFetch(async () => {
      throw unexpected;
    });

    await expect(notify(command)).rejects.toBe(unexpected);
  });
});
