import { afterEach, describe, expect, it, vi } from 'vitest';

import { createJobRepository, JobStoreUnavailableError } from './job-repository.js';

const SECRET = 'sb_secret_SECRETVALUE';

const input = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  ownerId: '00000000-0000-4000-8000-00000000000a',
  sha256: 'a'.repeat(64),
  sizeBytes: 100,
};

const jobRow = {
  created_at: '2026-09-26T12:53:00.123456+00:00',
  id: '00000000-0000-4000-8000-0000000000f1',
  meeting_id: input.meetingId,
  mime_type: 'audio/mp4',
  sha256: input.sha256,
  size_bytes: input.sizeBytes,
  status: 'created',
};

const snapshot = {
  createdAt: '2026-09-26T12:53:00.123Z',
  id: jobRow.id,
  meetingId: input.meetingId,
  mimeType: 'audio/mp4',
  sha256: input.sha256,
  sizeBytes: input.sizeBytes,
  status: 'created',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (implementation: (url: string, init: RequestInit) => Promise<Response>) => {
  const fetchMock = vi.fn(implementation);

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

const createRepository = (timeoutMs = 5000) =>
  createJobRepository({ secretKey: SECRET, supabaseUrl: 'https://store.test', timeoutMs });

const captureError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error('promise did not reject');
};

describe('createJobRepository', () => {
  it.each(['created', 'existing'] as const)('%s 응답을 JobSnapshot으로 바꾼다', async (kind) => {
    stubFetch(async () => Response.json({ job: jobRow, kind }));

    await expect(createRepository().createJob(input)).resolves.toEqual({ job: snapshot, kind });
  });

  it('conflict 응답은 job 없이 돌려준다', async () => {
    stubFetch(async () => Response.json({ kind: 'conflict' }));

    await expect(createRepository().createJob(input)).resolves.toEqual({ kind: 'conflict' });
  });

  it('RPC endpoint에 apikey와 snake_case 인자를 보내고 redirect를 따라가지 않는다', async () => {
    const fetchMock = stubFetch(async () => Response.json({ kind: 'conflict' }));

    await createRepository().createJob(input);

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://store.test/rest/v1/rpc/create_job_v1');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({
      p_idempotency_key: input.idempotencyKey,
      p_meeting_id: input.meetingId,
      p_mime_type: input.mimeType,
      p_owner_id: input.ownerId,
      p_sha256: input.sha256,
      p_size_bytes: input.sizeBytes,
    });
  });

  it('fetch가 TypeError로 reject하면 network로 분류한다', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error = await captureError(createRepository().createJob(input));

    expect(error).toBeInstanceOf(JobStoreUnavailableError);
    expect((error as JobStoreUnavailableError).reason).toBe('network');
  });

  it('timeoutMs 안에 응답이 없으면 timeout으로 분류한다', async () => {
    stubFetch(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    const error = await captureError(createRepository(10).createJob(input));

    expect(error).toBeInstanceOf(JobStoreUnavailableError);
    expect((error as JobStoreUnavailableError).reason).toBe('timeout');
  });

  it.each([
    ['TypeError', new TypeError('terminated'), 'network'],
    ['TimeoutError', new DOMException('timed out', 'TimeoutError'), 'timeout'],
  ])('body 읽기가 %s로 실패하면 %s로 분류한다', async (_label, cause, reason) => {
    stubFetch(async () => {
      const response = new Response('{}');

      vi.spyOn(response, 'json').mockRejectedValue(cause);

      return response;
    });

    const error = await captureError(createRepository().createJob(input));

    expect(error).toBeInstanceOf(JobStoreUnavailableError);
    expect((error as JobStoreUnavailableError).reason).toBe(reason);
  });

  it.each([502, 503, 504, 429])('HTTP %d는 저장소 일시 장애로 분류한다', async (status) => {
    stubFetch(async () => new Response(null, { status }));

    const error = await captureError(createRepository().createJob(input));

    expect(error).toBeInstanceOf(JobStoreUnavailableError);
    expect((error as JobStoreUnavailableError).reason).toBe(`http_${status}`);
  });

  it.each([302, 400, 409, 500])('HTTP %d는 상태 코드만 담은 Error로 바꾼다', async (status) => {
    stubFetch(async () => new Response(null, { status }));

    const error = await captureError(createRepository().createJob(input));

    expect(error).not.toBeInstanceOf(JobStoreUnavailableError);
    expect(error.message).toBe(`create_job_v1 http_${status}`);
  });

  it.each([
    ['깨진 JSON', () => new Response('{not json')],
    [
      '형식이 다른 응답',
      () => Response.json({ job: { ...jobRow, id: 'not-uuid' }, kind: 'created' }),
    ],
    ['알 수 없는 kind', () => Response.json({ kind: 'deleted' })],
  ])('%s는 invalid response Error로 바꾼다', async (_label, createResponse) => {
    stubFetch(async () => createResponse());

    const error = await captureError(createRepository().createJob(input));

    expect(error).not.toBeInstanceOf(JobStoreUnavailableError);
    expect(error.message).toBe('create_job_v1 invalid response');
    expect(error.cause).toBeUndefined();
  });

  it('분류 밖 예외는 원본 message·cause를 잇지 않는다', async () => {
    stubFetch(async () => {
      throw new RangeError(`bad ${SECRET}`, { cause: SECRET });
    });

    const error = await captureError(createRepository().createJob(input));

    expect(error.message).toBe('create_job_v1 unexpected error');
    expect(error.stack).not.toContain('SECRETVALUE');
    expect(error.cause).toBeUndefined();
  });

  it('non-2xx 응답의 body는 읽지 않고 cancel하며 오류에 담지 않는다', async () => {
    const cancel = vi.fn();

    stubFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`leak ${SECRET}`));
            },
          }),
          { status: 500 },
        ),
    );

    const error = await captureError(createRepository().createJob(input));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain('SECRETVALUE');
    expect(error.stack).not.toContain('SECRETVALUE');
  });
});

describe('findOwnedJob', () => {
  const ownedInput = { jobId: jobRow.id, ownerId: input.ownerId };

  it('jobs를 id·owner_id로 조회하고 apikey를 붙이며 redirect를 따라가지 않는다', async () => {
    const fetchMock = stubFetch(async () => Response.json([]));

    await createRepository().findOwnedJob(ownedInput);

    const [url, init] = fetchMock.mock.calls[0]!;
    const { pathname, searchParams } = new URL(url);

    expect(pathname).toBe('/rest/v1/jobs');
    expect(Object.fromEntries(searchParams)).toEqual({
      id: `eq.${jobRow.id}`,
      owner_id: `eq.${input.ownerId}`,
      select: 'id,meeting_id,status,size_bytes,sha256,mime_type,created_at',
    });
    expect(init.method).toBeUndefined();
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
  });

  it('row 1건은 JobSnapshot으로 바꾼다', async () => {
    stubFetch(async () => Response.json([jobRow]));

    await expect(createRepository().findOwnedJob(ownedInput)).resolves.toEqual(snapshot);
  });

  it('row가 없으면 null을 돌려준다', async () => {
    stubFetch(async () => Response.json([]));

    await expect(createRepository().findOwnedJob(ownedInput)).resolves.toBeNull();
  });

  it.each([
    ['row 2건', () => Response.json([jobRow, jobRow])],
    ['형식이 다른 row', () => Response.json([{ ...jobRow, status: 'uploading' }])],
    ['깨진 JSON', () => new Response('{not json')],
  ])('%s는 invalid response Error로 바꾼다', async (_label, createResponse) => {
    stubFetch(async () => createResponse());

    const error = await captureError(createRepository().findOwnedJob(ownedInput));

    expect(error).not.toBeInstanceOf(JobStoreUnavailableError);
    expect(error.message).toBe('select_jobs invalid response');
  });

  it('HTTP 503은 저장소 일시 장애, HTTP 500은 상태 코드만 담은 Error다', async () => {
    stubFetch(async () => new Response(null, { status: 503 }));

    const unavailable = await captureError(createRepository().findOwnedJob(ownedInput));

    stubFetch(async () => new Response(null, { status: 500 }));

    const failed = await captureError(createRepository().findOwnedJob(ownedInput));

    expect((unavailable as JobStoreUnavailableError).reason).toBe('http_503');
    expect(failed.message).toBe('select_jobs http_500');
  });
});

describe('claimJob', () => {
  const leaseRow = {
    expires_at: '2026-09-26T12:58:00.123456+00:00',
    lease_id: '00000000-0000-4000-8000-0000000001f1',
  };

  it('claim_job_v1을 빈 인자로 호출하고 redirect를 따라가지 않는다', async () => {
    const fetchMock = stubFetch(async () => Response.json({ kind: 'idle' }));

    await createRepository().claimJob();

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://store.test/rest/v1/rpc/claim_job_v1');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('claimed는 JobSnapshot과 UTC ISO 기한의 lease로 바꾼다', async () => {
    stubFetch(async () =>
      Response.json({ job: { ...jobRow, status: 'processing' }, kind: 'claimed', lease: leaseRow }),
    );

    await expect(createRepository().claimJob()).resolves.toEqual({
      job: { ...snapshot, status: 'processing' },
      kind: 'claimed',
      lease: { expiresAt: '2026-09-26T12:58:00.123Z', leaseId: leaseRow.lease_id },
    });
  });

  it('idle은 job 없이 돌려준다', async () => {
    stubFetch(async () => Response.json({ kind: 'idle' }));

    await expect(createRepository().claimJob()).resolves.toEqual({ kind: 'idle' });
  });

  it('lease가 빠진 claimed는 invalid response Error다', async () => {
    stubFetch(async () => Response.json({ job: jobRow, kind: 'claimed' }));

    const error = await captureError(createRepository().claimJob());

    expect(error).not.toBeInstanceOf(JobStoreUnavailableError);
    expect(error.message).toBe('claim_job_v1 invalid response');
  });
});

describe('renewJobLease', () => {
  const renewal = { jobId: jobRow.id, leaseId: '00000000-0000-4000-8000-0000000001f1' };

  it('renew_job_lease_v1에 snake_case 인자를 보내고 redirect를 따라가지 않는다', async () => {
    const fetchMock = stubFetch(async () => Response.json({ kind: 'stale' }));

    await createRepository().renewJobLease(renewal);

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://store.test/rest/v1/rpc/renew_job_lease_v1');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({
      p_job_id: renewal.jobId,
      p_lease_id: renewal.leaseId,
    });
  });

  it('renewed는 UTC ISO 기한으로 바꾼다', async () => {
    stubFetch(async () =>
      Response.json({ expires_at: '2026-09-26T12:58:00.123456+00:00', kind: 'renewed' }),
    );

    await expect(createRepository().renewJobLease(renewal)).resolves.toEqual({
      expiresAt: '2026-09-26T12:58:00.123Z',
      kind: 'renewed',
    });
  });

  it('stale은 기한 없이 돌려준다', async () => {
    stubFetch(async () => Response.json({ kind: 'stale' }));

    await expect(createRepository().renewJobLease(renewal)).resolves.toEqual({ kind: 'stale' });
  });

  it('HTTP 503은 저장소 일시 장애다', async () => {
    stubFetch(async () => new Response(null, { status: 503 }));

    const error = await captureError(createRepository().renewJobLease(renewal));

    expect((error as JobStoreUnavailableError).reason).toBe('http_503');
  });
});

describe('failJob', () => {
  const failure = { jobId: jobRow.id, leaseId: '00000000-0000-4000-8000-0000000001f1' };

  it('fail_job_v1에 snake_case 인자를 보내고 redirect를 따라가지 않는다', async () => {
    const fetchMock = stubFetch(async () => Response.json({ kind: 'stale' }));

    await createRepository().failJob(failure);

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://store.test/rest/v1/rpc/fail_job_v1');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({
      p_job_id: failure.jobId,
      p_lease_id: failure.leaseId,
    });
  });

  it.each(['failed', 'stale'] as const)('%s를 그대로 돌려준다', async (kind) => {
    stubFetch(async () => Response.json({ kind }));

    await expect(createRepository().failJob(failure)).resolves.toEqual({ kind });
  });

  it('알 수 없는 kind는 invalid response Error다', async () => {
    stubFetch(async () => Response.json({ kind: 'completed' }));

    const error = await captureError(createRepository().failJob(failure));

    expect(error.message).toBe('fail_job_v1 invalid response');
  });

  it('HTTP 503은 저장소 일시 장애다', async () => {
    stubFetch(async () => new Response(null, { status: 503 }));

    const error = await captureError(createRepository().failJob(failure));

    expect((error as JobStoreUnavailableError).reason).toBe('http_503');
  });
});
