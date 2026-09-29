import { type JobSnapshot, uploadGrantClaimsSchema } from '@echonote/contracts';
import { jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type JobRepository, JobStoreUnavailableError } from '../jobs/job-repository.js';
import { buildServer } from '../server.js';
import { createUploadGrantIssuer, type IssueUploadGrant } from './upload-grant-issuer.js';

const OWNER_ID = '00000000-0000-4000-8000-00000000000a';
const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const TOKEN = 'token-leak-probe-91c2';
const GRANT = 'grant-leak-probe-4d7e';

const job: JobSnapshot = {
  createdAt: '2026-09-26T12:53:00.123Z',
  id: JOB_ID,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4',
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'created',
};

const uploadGrant = {
  expiresAt: '2026-09-28T00:05:00.000Z',
  grant: GRANT,
  uploadUrl: 'https://receiver.example.ts.net/uploads',
};

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildGrantServer = (
  findOwnedJob: JobRepository['findOwnedJob'],
  {
    issue = async () => uploadGrant,
    userId = OWNER_ID,
  }: { issue?: IssueUploadGrant; userId?: string } = {},
) => {
  const logLines: string[] = [];
  const jobRepository = {
    claimJob: vi.fn(),
    completeUpload: vi.fn(),
    createJob: vi.fn(),
    findOwnedJob: vi.fn(findOwnedJob),
    renewJobLease: vi.fn(),
  };
  const issueUploadGrant = vi.fn(issue);
  const server = buildServer({
    issueUploadGrant,
    jobRepository,
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
    verifier: { verify: async () => ({ id: userId }) },
    workerApiToken: 'worker-token',
  });

  servers.push(server);

  const logsAt = (level: number) =>
    logLines.map((line) => JSON.parse(line)).filter((entry) => entry.level === level);

  return { issueUploadGrant, jobRepository, logLines, logsAt, server };
};

const postGrant = (
  server: ReturnType<typeof buildServer>,
  {
    headers = {},
    jobId = JOB_ID,
    payload,
  }: { headers?: Record<string, string>; jobId?: string; payload?: string | Buffer } = {},
) =>
  server.inject({
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    method: 'POST',
    payload,
    url: `/v1/jobs/${jobId}/upload-grants`,
  });

describe('POST /v1/jobs/:jobId/upload-grants', () => {
  it('created job은 200과 no-store grant를 반환하고 owner로 job을 찾는다', async () => {
    const { issueUploadGrant, jobRepository, server } = buildGrantServer(async () => job);

    const response = await postGrant(server);

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(uploadGrant);
    expect(jobRepository.findOwnedJob).toHaveBeenCalledWith({ jobId: JOB_ID, ownerId: OWNER_ID });
    expect(issueUploadGrant).toHaveBeenCalledWith({ job, ownerId: OWNER_ID });
  });

  it('없거나 다른 owner의 job은 404를 반환한다', async () => {
    const { issueUploadGrant, server } = buildGrantServer(async () => null);

    const response = await postGrant(server);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'job_not_found' });
    expect(issueUploadGrant).not.toHaveBeenCalled();
  });

  it.each(['queued', 'processing', 'completed', 'failed'] as const)(
    '%s job은 409를 반환한다',
    async (status) => {
      const { issueUploadGrant, server } = buildGrantServer(async () => ({ ...job, status }));

      const response = await postGrant(server);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'job_not_uploadable' });
      expect(issueUploadGrant).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['uuid가 아닌 jobId', { jobId: 'job-1' }],
    ['content-type 없는 문자열 body', { payload: 'x' }],
    ['content-type 없는 Buffer body', { payload: Buffer.from('x') }],
    ['text/plain body', { headers: { 'content-type': 'text/plain' }, payload: 'x' }],
    ['JSON body', { headers: { 'content-type': 'application/json' }, payload: '{}' }],
    ['빈 JSON body', { headers: { 'content-type': 'application/json' }, payload: '' }],
    ['audio/mp4 body', { headers: { 'content-type': 'audio/mp4' }, payload: 'x' }],
  ])('%s는 400 invalid_request를 반환하고 job을 찾지 않는다', async (_label, options) => {
    const { jobRepository, server } = buildGrantServer(async () => job);

    const response = await postGrant(server, options);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(jobRepository.findOwnedJob).not.toHaveBeenCalled();
  });

  it('uuid가 아닌 sub는 401을 반환한다', async () => {
    const { jobRepository, server } = buildGrantServer(async () => job, { userId: 'user-1' });

    const response = await postGrant(server);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(jobRepository.findOwnedJob).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503과 reason만 담은 warn 로그를 남긴다', async () => {
    const { issueUploadGrant, logsAt, server } = buildGrantServer(async () => {
      throw new JobStoreUnavailableError('http_503');
    });

    const response = await postGrant(server);
    const warnings = logsAt(40);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'job_store_unavailable' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('http_503');
    expect(warnings[0]).not.toHaveProperty('err');
    expect(issueUploadGrant).not.toHaveBeenCalled();
  });

  it.each([
    [
      'job 조회 Error',
      async () => {
        throw new Error('select_jobs http_500');
      },
      undefined,
    ],
    [
      'grant 발급 Error',
      async () => job,
      async () => {
        throw new Error('sign failed');
      },
    ],
  ] as const)(
    '%s는 500 internal과 error 로그 1건을 남긴다',
    async (_label, findOwnedJob, issue) => {
      const { logsAt, server } = buildGrantServer(findOwnedJob, { issue });

      const response = await postGrant(server);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal' });
      expect(logsAt(50)).toHaveLength(1);
    },
  );

  it('어떤 응답 경로의 로그에도 access token과 grant가 남지 않는다', async () => {
    const outcomes: JobRepository['findOwnedJob'][] = [
      async () => job,
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('select_jobs unexpected error');
      },
    ];

    for (const findOwnedJob of outcomes) {
      const { logLines, server } = buildGrantServer(findOwnedJob);

      await postGrant(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(TOKEN);
      expect(logLines.join('')).not.toContain(GRANT);
    }
  });

  it('실제 issuer와 조합하면 grant가 요청한 job과 owner를 담고 uploadUrl에는 jobId가 없다', async () => {
    const secret = new Uint8Array(32).fill(7);
    const { server } = buildGrantServer(async () => job, {
      issue: createUploadGrantIssuer({ receiverOrigin: 'https://receiver.example.ts.net', secret }),
    });

    const response = await postGrant(server);

    expect(response.statusCode).toBe(200);

    const { grant, uploadUrl } = response.json<typeof uploadGrant>();
    const claims = uploadGrantClaimsSchema.parse((await jwtVerify(grant, secret)).payload);

    expect(claims.job_id).toBe(JOB_ID);
    expect(claims.sub).toBe(OWNER_ID);
    expect(uploadUrl).toBe('https://receiver.example.ts.net/uploads');
    expect(uploadUrl).not.toContain(JOB_ID);
  });
});
