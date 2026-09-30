import { completeJobRequestSchema } from '@echonote/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createJobLeaseClient } from './job-lease-client.js';
import { JobLeaseClientError } from './job-lease-error.js';

const GATEWAY_ORIGIN = 'https://gateway.example.test';
const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');
const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const LEASE_ID = '00000000-0000-4000-8000-0000000001f1';

const job = {
  createdAt: '2026-09-29T12:00:00.123Z',
  id: JOB_ID,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4',
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'processing',
};

const lease = { expiresAt: '2026-09-29T12:05:00.000Z', leaseId: LEASE_ID };

const transcript = { durationMs: 2000, segments: [{ endMs: 1000, startMs: 0, text: '안녕' }] };

const client = createJobLeaseClient({
  gatewayOrigin: GATEWAY_ORIGIN,
  workerApiToken: WORKER_API_TOKEN,
});

const stubFetch = (implementation: () => Promise<Response>) => {
  const fetchMock = vi.fn(implementation);

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

const captureError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error('promise did not reject');
};

const calls = {
  claim: () => client.claim(),
  complete: () => client.complete({ jobId: JOB_ID, leaseId: LEASE_ID }, transcript),
  fail: () => client.fail({ jobId: JOB_ID, leaseId: LEASE_ID }, 'stt_failed'),
  renew: () => client.renew({ jobId: JOB_ID, leaseId: LEASE_ID }),
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createJobLeaseClient', () => {
  it.each([
    ['claim', '/v1/worker/jobs/claim', {}],
    ['renew', `/v1/worker/jobs/${JOB_ID}/lease`, { leaseId: LEASE_ID }],
    ['fail', `/v1/worker/jobs/${JOB_ID}/fail`, { errorCode: 'stt_failed', leaseId: LEASE_ID }],
    ['complete', `/v1/worker/jobs/${JOB_ID}/complete`, { leaseId: LEASE_ID, transcript }],
  ] as const)(
    '%s는 Worker token으로 %s에 POST하고 redirect를 따라가지 않는다',
    async (name, path, body) => {
      const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));

      await calls[name]().catch(() => undefined);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
      const headers = new Headers(init.headers);

      expect(url.href).toBe(`${GATEWAY_ORIGIN}${path}`);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(headers.get('authorization')).toBe(`Bearer ${WORKER_API_TOKEN}`);
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(body);
    },
  );

  it('claim 200은 job·lease를 담은 claimed다', async () => {
    stubFetch(async () => Response.json({ job, lease }));

    await expect(client.claim()).resolves.toEqual({ job, kind: 'claimed', lease });
  });

  it('claim 204는 idle이다', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    await expect(client.claim()).resolves.toEqual({ kind: 'idle' });
  });

  it('renew 200은 새 기한을 담은 renewed다', async () => {
    stubFetch(async () => Response.json({ expiresAt: lease.expiresAt }));

    await expect(calls.renew()).resolves.toEqual({ expiresAt: lease.expiresAt, kind: 'renewed' });
  });

  it('fail 204는 failed다', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    await expect(calls.fail()).resolves.toEqual({ kind: 'failed' });
  });

  it('complete 204는 completed다', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    await expect(calls.complete()).resolves.toEqual({ kind: 'completed' });
  });

  it('complete는 transcript의 계약 밖 필드를 보내지 않는다', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));

    await client.complete({ jobId: JOB_ID, leaseId: LEASE_ID }, {
      ...transcript,
      schemaVersion: 1,
    } as typeof transcript);

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];

    expect(JSON.parse(init.body as string)).toEqual({ leaseId: LEASE_ID, transcript });
    expect(completeJobRequestSchema.safeParse(JSON.parse(init.body as string)).success).toBe(true);
  });

  it.each(['renew', 'fail', 'complete'] as const)(
    '%s 409 lease_stale은 stale이다',
    async (name) => {
      stubFetch(async () => Response.json({ error: 'lease_stale' }, { status: 409 }));

      await expect(calls[name]()).resolves.toEqual({ kind: 'stale' });
    },
  );

  it.each(['renew', 'fail', 'complete'] as const)('%s의 다른 409는 gateway_409다', async (name) => {
    for (const body of [JSON.stringify({ error: 'other' }), 'not json', null]) {
      stubFetch(async () => new Response(body, { status: 409 }));

      await expect(captureError(calls[name]())).resolves.toMatchObject({ reason: 'gateway_409' });
    }
  });

  it.each([
    ['claim', 201],
    ['renew', 204],
    ['fail', 200],
    ['claim', 302],
    ['renew', 401],
    ['fail', 503],
    ['complete', 200],
    ['complete', 400],
    ['complete', 413],
  ] as const)('%s의 예상 밖 상태 %i는 gateway_<status>다', async (name, status) => {
    stubFetch(async () => new Response(null, { status }));

    const error = await captureError(calls[name]());

    expect(error).toBeInstanceOf(JobLeaseClientError);
    expect(error).toMatchObject({ reason: `gateway_${status}` });
  });

  it.each([
    ['claim job.id 비uuid', 'claim', Response.json({ job: { ...job, id: 'job-1' }, lease })],
    [
      'claim leaseId 비uuid',
      'claim',
      Response.json({ job, lease: { ...lease, leaseId: 'lease-1' } }),
    ],
    ['claim JSON 깨짐', 'claim', new Response('{', { status: 200 })],
    ['renew expiresAt 비ISO', 'renew', Response.json({ expiresAt: 'tomorrow' })],
  ] as const)('%s: 200 본문이 계약과 다르면 invalid_response다', async (_label, name, response) => {
    stubFetch(async () => response);

    await expect(captureError(calls[name]())).resolves.toMatchObject({
      reason: 'invalid_response',
    });
  });

  it.each([
    ['TimeoutError', new DOMException('signal timed out', 'TimeoutError'), 'timeout'],
    [
      'TypeError',
      new TypeError('fetch failed', { cause: new Error(`connect ${GATEWAY_ORIGIN}`) }),
      'network',
    ],
  ])('fetch가 %s로 reject하면 분류하고 URL·token을 담지 않는다', async (_label, cause, reason) => {
    stubFetch(async () => {
      throw cause;
    });

    const error = await captureError(client.claim());

    expect(error).toMatchObject({ reason });
    expect(error.cause).toBeUndefined();
    expect(`${error.message}${error.stack}`).not.toContain(GATEWAY_ORIGIN);
    expect(`${error.message}${error.stack}`).not.toContain(WORKER_API_TOKEN);
  });

  it('요청마다 10초 timeout signal을 건다', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    stubFetch(async () => new Response(null, { status: 204 }));
    await client.claim();

    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it.each([
    [
      'claim 200 timeout',
      'claim',
      200,
      new DOMException('signal timed out', 'TimeoutError'),
      'timeout',
    ],
    ['claim 200 network', 'claim', 200, new TypeError('terminated'), 'network'],
    [
      'renew 409 timeout',
      'renew',
      409,
      new DOMException('signal timed out', 'TimeoutError'),
      'timeout',
    ],
    ['fail 409 network', 'fail', 409, new TypeError('terminated'), 'network'],
    [
      'complete 409 timeout',
      'complete',
      409,
      new DOMException('signal timed out', 'TimeoutError'),
      'timeout',
    ],
  ] as const)('%s: 본문 읽기가 끊겨도 분류한다', async (_label, name, status, cause, reason) => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(cause);
      },
    });

    stubFetch(async () => new Response(body, { status }));

    await expect(captureError(calls[name]())).resolves.toMatchObject({ reason });
  });

  it('분류 밖 예외는 변환하지 않고 그대로 던진다', async () => {
    const unexpected = new RangeError('unexpected');

    stubFetch(async () => {
      throw unexpected;
    });

    await expect(client.claim()).rejects.toBe(unexpected);
  });
});
