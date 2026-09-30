import { afterEach, describe, expect, it, vi } from 'vitest';

import { type JobRepository, JobStoreUnavailableError } from '../jobs/job-repository.js';
import { buildServer } from '../server.js';

const WORKER_API_TOKEN = Buffer.alloc(32, 9).toString('base64');

const completion = {
  jobId: '00000000-0000-4000-8000-0000000000f1',
  mimeType: 'audio/mp4',
  ownerId: '00000000-0000-4000-8000-00000000000a',
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
};

const job = {
  createdAt: '2026-09-29T12:00:00.123Z',
  id: completion.jobId,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  sha256: completion.sha256,
  sizeBytes: completion.sizeBytes,
  status: 'queued' as const,
};

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildCompletionServer = (completeUpload: JobRepository['completeUpload']) => {
  const logLines: string[] = [];
  const jobRepository = {
    claimJob: vi.fn(),
    completeUpload: vi.fn(completeUpload),
    createJob: vi.fn(),
    failJob: vi.fn(),
    findOwnedJob: vi.fn(),
    renewJobLease: vi.fn(),
  };
  const server = buildServer({
    issueUploadGrant: vi.fn(),
    jobRepository,
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
    verifier: { verify: async () => ({ id: completion.ownerId }) },
    workerApiToken: WORKER_API_TOKEN,
  });

  servers.push(server);

  return { jobRepository, logLines, server };
};

const postCompletion = (
  server: ReturnType<typeof buildServer>,
  payload: string = JSON.stringify(completion),
) =>
  server.inject({
    headers: {
      authorization: `Bearer ${WORKER_API_TOKEN}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    payload,
    url: '/v1/worker/upload-completions',
  });

describe('POST /v1/worker/upload-completions', () => {
  it('queued는 201과 JobSnapshot을 반환하고 body를 그대로 repository에 넘긴다', async () => {
    const { jobRepository, server } = buildCompletionServer(async () => ({ job, kind: 'queued' }));

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(job);
    expect(jobRepository.completeUpload).toHaveBeenCalledWith(completion);
  });

  it('existing은 200과 현재 JobSnapshot을 반환한다', async () => {
    const processing = { ...job, status: 'processing' as const };
    const { server } = buildCompletionServer(async () => ({ job: processing, kind: 'existing' }));

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(processing);
  });

  it('conflict는 409를 반환한다', async () => {
    const { server } = buildCompletionServer(async () => ({ kind: 'conflict' }));

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'upload_completion_conflict' });
  });

  it('not_found는 404를 반환한다', async () => {
    const { server } = buildCompletionServer(async () => ({ kind: 'not_found' }));

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'job_not_found' });
  });

  it.each([
    ['지원하지 않는 MIME', JSON.stringify({ ...completion, mimeType: 'audio/wav' })],
    ['uuid가 아닌 jobId', JSON.stringify({ ...completion, jobId: 'job-1' })],
    ['정의하지 않은 필드', JSON.stringify({ ...completion, status: 'queued' })],
    ['malformed JSON', '{"jobId":'],
  ])('%s는 400 invalid_request이고 repository를 호출하지 않는다', async (_label, payload) => {
    const { jobRepository, server } = buildCompletionServer(async () => ({ kind: 'conflict' }));

    const response = await postCompletion(server, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(jobRepository.completeUpload).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503이다', async () => {
    const { server } = buildCompletionServer(async () => {
      throw new JobStoreUnavailableError('timeout');
    });

    const response = await postCompletion(server);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'job_store_unavailable' });
  });

  it('어떤 응답 경로의 로그에도 token과 sha256이 남지 않는다', async () => {
    const outcomes: JobRepository['completeUpload'][] = [
      async () => ({ job, kind: 'queued' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('complete_upload_v1 unexpected error');
      },
    ];

    for (const completeUpload of outcomes) {
      const { logLines, server } = buildCompletionServer(completeUpload);

      await postCompletion(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(WORKER_API_TOKEN);
      expect(logLines.join('')).not.toContain(completion.sha256);
    }
  });
});
