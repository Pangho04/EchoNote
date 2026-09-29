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
  renewJobLease = async () => ({ kind: 'stale' }),
}: Partial<Pick<JobRepository, 'claimJob' | 'renewJobLease'>> = {}) => {
  const logLines: string[] = [];
  const jobRepository = {
    claimJob: vi.fn(claimJob),
    completeUpload: vi.fn(),
    createJob: vi.fn(),
    findOwnedJob: vi.fn(),
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

const postRenewal = (
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
    url: `/v1/worker/jobs/${jobId}/lease`,
  });

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

  it.each([
    ['uuid가 아닌 jobId', { jobId: 'job-1' }],
    ['uuid가 아닌 leaseId', { payload: JSON.stringify({ leaseId: 'lease-1' }) }],
    ['leaseId 누락', { payload: '{}' }],
    [
      '정의하지 않은 필드',
      { payload: JSON.stringify({ leaseId: LEASE_ID, status: 'processing' }) },
    ],
    ['malformed JSON', { payload: '{"leaseId":' }],
  ])('%s는 400 invalid_request이고 repository를 호출하지 않는다', async (_label, input) => {
    const { jobRepository, server } = buildWorkerServer();

    const response = await postRenewal(server, input);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(jobRepository.renewJobLease).not.toHaveBeenCalled();
  });

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
