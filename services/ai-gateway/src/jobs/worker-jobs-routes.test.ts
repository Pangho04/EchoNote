import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../server.js';
import { type JobRepository, JobStoreUnavailableError } from './job-repository.js';

const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');
const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const LEASE_ID = '00000000-0000-4000-8000-0000000001f1';

const job = {
  createdAt: '2026-09-29T12:00:00.123Z',
  id: JOB_ID,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'processing' as const,
};

const lease = { expiresAt: '2026-09-29T12:05:00.000Z', leaseId: LEASE_ID };

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildWorkerServer = ({
  claimJob = async () => ({ kind: 'idle' }),
  completeJob = async () => ({ kind: 'stale' }),
  failJob = async () => ({ kind: 'stale' }),
  renewJobLease = async () => ({ kind: 'stale' }),
}: Partial<Pick<JobRepository, 'claimJob' | 'completeJob' | 'failJob' | 'renewJobLease'>> = {}) => {
  const logLines: string[] = [];
  const jobRepository = {
    claimJob: vi.fn(claimJob),
    completeJob: vi.fn(completeJob),
    completeUpload: vi.fn(),
    createJob: vi.fn(),
    failJob: vi.fn(failJob),
    findOwnedJob: vi.fn(),
    findOwnedTranscript: vi.fn(),
    renewJobLease: vi.fn(renewJobLease),
  };
  const server = buildServer({
    issueUploadGrant: vi.fn(),
    jobRepository,
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
    verifier: { verify: async () => ({ id: '00000000-0000-4000-8000-00000000000a' }) },
    workerApiToken: WORKER_API_TOKEN,
  });

  servers.push(server);

  return { jobRepository, logLines, server };
};

const postClaim = (server: ReturnType<typeof buildServer>, token = WORKER_API_TOKEN) =>
  server.inject({
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    url: '/v1/worker/jobs/claim',
  });

const postLeaseAction =
  (action: 'fail' | 'lease') =>
  (
    server: ReturnType<typeof buildServer>,
    {
      jobId = JOB_ID,
      payload = JSON.stringify({ leaseId: LEASE_ID }),
      token = WORKER_API_TOKEN,
    } = {},
  ) =>
    server.inject({
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'POST',
      payload,
      url: `/v1/worker/jobs/${jobId}/${action}`,
    });

const postRenewal = postLeaseAction('lease');
const postFailure = postLeaseAction('fail');

const invalidLeaseRequests = [
  ['uuid가 아닌 jobId', { jobId: 'job-1' }],
  ['uuid가 아닌 leaseId', { payload: JSON.stringify({ leaseId: 'lease-1' }) }],
  ['leaseId 누락', { payload: '{}' }],
  ['정의하지 않은 필드', { payload: JSON.stringify({ leaseId: LEASE_ID, status: 'processing' }) }],
  ['malformed JSON', { payload: '{"leaseId":' }],
] as const;

describe('POST /v1/worker/jobs/claim', () => {
  it('claimed는 200과 job·lease를 반환한다', async () => {
    const { server } = buildWorkerServer({
      claimJob: async () => ({ job, kind: 'claimed', lease }),
    });

    const response = await postClaim(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ job, lease });
  });

  it('idle은 body 없는 204다', async () => {
    const { server } = buildWorkerServer();

    const response = await postClaim(server);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('Worker token이 틀리면 401이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildWorkerServer();

    const response = await postClaim(server, Buffer.alloc(32, 8).toString('base64'));

    expect(response.statusCode).toBe(401);
    expect(jobRepository.claimJob).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503이다', async () => {
    const { server } = buildWorkerServer({
      claimJob: async () => {
        throw new JobStoreUnavailableError('timeout');
      },
    });

    const response = await postClaim(server);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'job_store_unavailable' });
  });

  it('어떤 응답 경로의 로그에도 token과 leaseId가 남지 않는다', async () => {
    const outcomes: JobRepository['claimJob'][] = [
      async () => ({ job, kind: 'claimed', lease }),
      async () => ({ kind: 'idle' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('claim_job_v1 unexpected error');
      },
    ];

    for (const claimJob of outcomes) {
      const { logLines, server } = buildWorkerServer({ claimJob });

      await postClaim(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(LEASE_ID);
    }
  });
});

describe('POST /v1/worker/jobs/:jobId/lease', () => {
  it('renewed는 200과 새 기한을 반환하고 jobId·leaseId를 repository에 넘긴다', async () => {
    const { jobRepository, server } = buildWorkerServer({
      renewJobLease: async () => ({ expiresAt: lease.expiresAt, kind: 'renewed' }),
    });

    const response = await postRenewal(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expiresAt: lease.expiresAt });
    expect(jobRepository.renewJobLease).toHaveBeenCalledWith({ jobId: JOB_ID, leaseId: LEASE_ID });
  });

  it('stale은 409 lease_stale이다', async () => {
    const { server } = buildWorkerServer();

    const response = await postRenewal(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'lease_stale' });
  });

  it.each(invalidLeaseRequests)(
    '%s는 400 invalid_request이고 repository를 호출하지 않는다',
    async (_label, input) => {
      const { jobRepository, server } = buildWorkerServer();

      const response = await postRenewal(server, input);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(jobRepository.renewJobLease).not.toHaveBeenCalled();
    },
  );

  it('Worker token이 틀리면 401이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildWorkerServer();

    const response = await postRenewal(server, { token: Buffer.alloc(32, 8).toString('base64') });

    expect(response.statusCode).toBe(401);
    expect(jobRepository.renewJobLease).not.toHaveBeenCalled();
  });

  it('어떤 응답 경로의 로그에도 token과 leaseId가 남지 않는다', async () => {
    const outcomes: JobRepository['renewJobLease'][] = [
      async () => ({ expiresAt: lease.expiresAt, kind: 'renewed' }),
      async () => ({ kind: 'stale' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('renew_job_lease_v1 unexpected error');
      },
    ];

    for (const renewJobLease of outcomes) {
      const { logLines, server } = buildWorkerServer({ renewJobLease });

      await postRenewal(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(LEASE_ID);
    }
  });
});

describe('POST /v1/worker/jobs/:jobId/fail', () => {
  it('failed는 body 없는 204이고 jobId·leaseId를 repository에 넘긴다', async () => {
    const { jobRepository, server } = buildWorkerServer({
      failJob: async () => ({ kind: 'failed' }),
    });

    const response = await postFailure(server);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(jobRepository.failJob).toHaveBeenCalledWith({ jobId: JOB_ID, leaseId: LEASE_ID });
  });

  it('stale은 409 lease_stale이다', async () => {
    const { server } = buildWorkerServer();

    const response = await postFailure(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'lease_stale' });
  });

  it.each(invalidLeaseRequests)(
    '%s는 400 invalid_request이고 repository를 호출하지 않는다',
    async (_label, input) => {
      const { jobRepository, server } = buildWorkerServer();

      const response = await postFailure(server, input);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(jobRepository.failJob).not.toHaveBeenCalled();
    },
  );

  it('Worker token이 틀리면 401이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildWorkerServer();

    const response = await postFailure(server, { token: Buffer.alloc(32, 8).toString('base64') });

    expect(response.statusCode).toBe(401);
    expect(jobRepository.failJob).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503, 예상 밖 오류는 500이다', async () => {
    const unavailable = buildWorkerServer({
      failJob: async () => {
        throw new JobStoreUnavailableError('timeout');
      },
    });
    const unexpected = buildWorkerServer({
      failJob: async () => {
        throw new Error('fail_job_v1 unexpected error');
      },
    });

    const [unavailableResponse, unexpectedResponse] = await Promise.all([
      postFailure(unavailable.server),
      postFailure(unexpected.server),
    ]);

    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({ error: 'job_store_unavailable' });
    expect(unexpectedResponse.statusCode).toBe(500);
  });

  it('어떤 응답 경로의 로그에도 token과 leaseId가 남지 않는다', async () => {
    const outcomes: JobRepository['failJob'][] = [
      async () => ({ kind: 'failed' }),
      async () => ({ kind: 'stale' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('fail_job_v1 unexpected error');
      },
    ];

    for (const failJob of outcomes) {
      const { logLines, server } = buildWorkerServer({ failJob });

      await postFailure(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(LEASE_ID);
    }
  });
});

const SEGMENT_TEXT = 'segment-text-leak-probe';
const transcript = {
  durationMs: 2000,
  segments: [{ endMs: 1000, startMs: 0, text: SEGMENT_TEXT }],
};

const postCompletion = (
  server: ReturnType<typeof buildServer>,
  {
    jobId = JOB_ID,
    payload = JSON.stringify({ leaseId: LEASE_ID, transcript }),
    token = WORKER_API_TOKEN,
  } = {},
) =>
  server.inject({
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    method: 'POST',
    payload,
    url: `/v1/worker/jobs/${jobId}/complete`,
  });

describe('POST /v1/worker/jobs/:jobId/complete', () => {
  it('completed는 body 없는 204이고 jobId·leaseId·transcript를 repository에 넘긴다', async () => {
    const { jobRepository, server } = buildWorkerServer({
      completeJob: async () => ({ kind: 'completed' }),
    });

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(jobRepository.completeJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      leaseId: LEASE_ID,
      transcript,
    });
  });

  it('stale은 409 lease_stale이다', async () => {
    const { server } = buildWorkerServer();

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'lease_stale' });
  });

  it.each([
    ['uuid가 아닌 jobId', { jobId: 'job-1' }],
    ['transcript 누락', { payload: JSON.stringify({ leaseId: LEASE_ID }) }],
    [
      'durationMs를 넘는 segment',
      {
        payload: JSON.stringify({
          leaseId: LEASE_ID,
          transcript: { ...transcript, durationMs: 500 },
        }),
      },
    ],
    [
      '정의하지 않은 필드',
      { payload: JSON.stringify({ leaseId: LEASE_ID, status: 'completed', transcript }) },
    ],
    ['malformed JSON', { payload: '{"leaseId":' }],
  ] as const)(
    '%s는 400 invalid_request이고 repository를 호출하지 않는다',
    async (_label, input) => {
      const { jobRepository, server } = buildWorkerServer();

      const response = await postCompletion(server, input);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(jobRepository.completeJob).not.toHaveBeenCalled();
    },
  );

  it('segment 20,000개 요청은 기본 1 MiB를 넘어도 받는다', async () => {
    const { jobRepository, server } = buildWorkerServer({
      completeJob: async () => ({ kind: 'completed' }),
    });
    const segments = Array.from({ length: 20_000 }, (_, index) => ({
      endMs: index + 1,
      startMs: index,
      text: 'x'.repeat(80),
    }));
    const payload = JSON.stringify({
      leaseId: LEASE_ID,
      transcript: { durationMs: 20_000, segments },
    });

    expect(payload.length).toBeGreaterThan(2 * 1024 * 1024);

    const response = await postCompletion(server, { payload });

    expect(response.statusCode).toBe(204);
    expect(jobRepository.completeJob).toHaveBeenCalledOnce();
  });

  it('4 MiB를 넘는 body는 413이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildWorkerServer();
    const payload = JSON.stringify({ leaseId: LEASE_ID, padding: 'x'.repeat(4 * 1024 * 1024) });

    const response = await postCompletion(server, { payload });

    expect(response.statusCode).toBe(413);
    expect(jobRepository.completeJob).not.toHaveBeenCalled();
  });

  it('Worker token이 틀리면 401이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildWorkerServer();

    const response = await postCompletion(server, {
      token: Buffer.alloc(32, 8).toString('base64'),
    });

    expect(response.statusCode).toBe(401);
    expect(jobRepository.completeJob).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503, 예상 밖 오류는 500이다', async () => {
    const unavailable = buildWorkerServer({
      completeJob: async () => {
        throw new JobStoreUnavailableError('timeout');
      },
    });
    const unexpected = buildWorkerServer({
      completeJob: async () => {
        throw new Error('complete_job_v1 unexpected error');
      },
    });

    const [unavailableResponse, unexpectedResponse] = await Promise.all([
      postCompletion(unavailable.server),
      postCompletion(unexpected.server),
    ]);

    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({ error: 'job_store_unavailable' });
    expect(unexpectedResponse.statusCode).toBe(500);
  });

  it('어떤 응답 경로의 로그에도 token·leaseId·전사 본문이 남지 않는다', async () => {
    const outcomes: JobRepository['completeJob'][] = [
      async () => ({ kind: 'completed' }),
      async () => ({ kind: 'stale' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('complete_job_v1 unexpected error');
      },
    ];

    for (const completeJob of outcomes) {
      const { logLines, server } = buildWorkerServer({ completeJob });

      await postCompletion(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(LEASE_ID);
      expect(logLines.join('')).not.toContain(SEGMENT_TEXT);
    }
  });

  it('거부된 요청(400·413)의 로그에도 token·leaseId·전사 본문이 남지 않는다', async () => {
    const payloads = [
      [`{"leaseId":"${LEASE_ID}","transcript":{"text":"${SEGMENT_TEXT}"`, 400],
      [JSON.stringify({ leaseId: LEASE_ID, transcript: { ...transcript, durationMs: 500 } }), 400],
      [JSON.stringify({ leaseId: LEASE_ID, padding: SEGMENT_TEXT.repeat(300_000) }), 413],
    ] as const;

    for (const [payload, status] of payloads) {
      const { logLines, server } = buildWorkerServer();

      const response = await postCompletion(server, { payload });

      expect(response.statusCode).toBe(status);
      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(LEASE_ID);
      expect(logLines.join('')).not.toContain(SEGMENT_TEXT);
    }
  });
});
