import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../server.js';
import { type JobRepository, JobStoreUnavailableError } from './job-repository.js';

const OWNER_ID = '00000000-0000-4000-8000-00000000000a';
const TOKEN = 'token-leak-probe-91c2';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';

const body = {
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4',
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
};

const job = {
  ...body,
  createdAt: '2026-09-26T12:53:00.123Z',
  id: '00000000-0000-4000-8000-0000000000f1',
  status: 'created' as const,
  mimeType: 'audio/mp4' as const,
};

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

const buildJobsServer = (
  createJob: JobRepository['createJob'],
  userId = OWNER_ID,
  findOwnedTranscript: JobRepository['findOwnedTranscript'] = async () => null,
) => {
  const logLines: string[] = [];
  const jobRepository = {
    claimJob: vi.fn(),
    completeJob: vi.fn(),
    completeUpload: vi.fn(),
    createJob: vi.fn(createJob),
    failJob: vi.fn(),
    findOwnedJob: vi.fn(),
    findOwnedTranscript: vi.fn(findOwnedTranscript),
    renewJobLease: vi.fn(),
  };
  const server = buildServer({
    issueUploadGrant: vi.fn(),
    jobRepository,
    logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
    verifier: { verify: async () => ({ id: userId }) },
    workerApiToken: 'worker-token',
  });

  servers.push(server);

  const logsAt = (level: number) =>
    logLines.map((line) => JSON.parse(line)).filter((entry) => entry.level === level);

  return { jobRepository, logLines, logsAt, server };
};

const postJob = (
  server: ReturnType<typeof buildServer>,
  {
    headers = {},
    payload = JSON.stringify(body),
  }: { headers?: Record<string, string | undefined>; payload?: string } = {},
) =>
  server.inject({
    // 값이 undefined인 헤더는 보내지 않는다.
    headers: JSON.parse(
      JSON.stringify({
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'idempotency-key': IDEMPOTENCY_KEY,
        ...headers,
      }),
    ),
    method: 'POST',
    payload,
    url: '/v1/jobs',
  });

describe('POST /v1/jobs', () => {
  it('created는 201과 JobSnapshot을 반환하고 owner를 토큰의 sub로 묶는다', async () => {
    const { jobRepository, server } = buildJobsServer(async () => ({ job, kind: 'created' }));

    const response = await postJob(server);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(job);
    expect(jobRepository.createJob).toHaveBeenCalledWith({
      ...body,
      idempotencyKey: IDEMPOTENCY_KEY,
      ownerId: OWNER_ID,
    });
  });

  it('existing은 200과 현재 JobSnapshot을 반환한다', async () => {
    const { server } = buildJobsServer(async () => ({ job, kind: 'existing' }));

    const response = await postJob(server);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(job);
  });

  it('conflict는 409를 반환한다', async () => {
    const { server } = buildJobsServer(async () => ({ kind: 'conflict' }));

    const response = await postJob(server);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'idempotency_conflict' });
  });

  it.each([
    ['Idempotency-Key 누락', { headers: { 'idempotency-key': undefined } }],
    ['uuid가 아닌 Idempotency-Key', { headers: { 'idempotency-key': 'key-1' } }],
    ['body 규칙 위반', { payload: JSON.stringify({ ...body, sizeBytes: 0 }) }],
    ['body의 ownerId', { payload: JSON.stringify({ ...body, ownerId: OWNER_ID }) }],
    ['malformed JSON', { payload: '{"meetingId":' }],
    ['빈 JSON body', { payload: '' }],
    ['application/xml', { headers: { 'content-type': 'application/xml' }, payload: '<job/>' }],
  ])(
    '%s는 400 invalid_request를 반환하고 repository를 호출하지 않는다',
    async (_label, options) => {
      const { jobRepository, logsAt, server } = buildJobsServer(async () => ({ kind: 'conflict' }));

      const response = await postJob(server, options);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(jobRepository.createJob).not.toHaveBeenCalled();
      expect(logsAt(50)).toHaveLength(0);
    },
  );

  it('body 한도를 넘으면 Fastify 기본 413을 반환한다', async () => {
    const { jobRepository, server } = buildJobsServer(async () => ({ kind: 'conflict' }));

    const response = await postJob(server, {
      payload: JSON.stringify({ pad: 'x'.repeat(1_100_000) }),
    });

    expect(response.statusCode).toBe(413);
    expect(jobRepository.createJob).not.toHaveBeenCalled();
  });

  it('uuid가 아닌 sub는 401을 반환한다', async () => {
    const { jobRepository, server } = buildJobsServer(async () => ({ kind: 'conflict' }), 'user-1');

    const response = await postJob(server);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(jobRepository.createJob).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503과 reason만 담은 warn 로그를 남긴다', async () => {
    const { logsAt, server } = buildJobsServer(async () => {
      throw new JobStoreUnavailableError('timeout');
    });

    const response = await postJob(server);
    const warnings = logsAt(40);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'job_store_unavailable' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe('timeout');
    expect(warnings[0]).not.toHaveProperty('err');
  });

  it('repository Error는 500 internal을 반환하고 error 로그 1건만 남긴다', async () => {
    const { logsAt, server } = buildJobsServer(async () => {
      throw new Error('create_job_v1 http_500');
    });

    const response = await postJob(server);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(logsAt(50)).toHaveLength(1);
  });

  it('어떤 응답 경로의 로그에도 토큰과 sha256이 남지 않는다', async () => {
    const outcomes: JobRepository['createJob'][] = [
      async () => ({ job, kind: 'created' }),
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('create_job_v1 unexpected error');
      },
    ];

    for (const createJob of outcomes) {
      const { logLines, server } = buildJobsServer(createJob);

      await postJob(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(TOKEN);
      expect(logLines.join('')).not.toContain(body.sha256);
    }
  });
});

const TRANSCRIPT_JOB_ID = job.id;
const SEGMENT_TEXT = 'segment-text-leak-probe';
const transcript = {
  durationMs: 2000,
  segments: [{ endMs: 1000, startMs: 0, text: SEGMENT_TEXT }],
};

const getTranscript = (server: ReturnType<typeof buildServer>, jobId = TRANSCRIPT_JOB_ID) =>
  server.inject({
    headers: { authorization: `Bearer ${TOKEN}` },
    method: 'GET',
    url: `/v1/jobs/${jobId}/transcript`,
  });

const noCreate: JobRepository['createJob'] = async () => ({ kind: 'conflict' });

describe('GET /v1/jobs/:jobId/transcript', () => {
  it('owner의 전사 결과는 200 no-store이고 owner로 찾는다', async () => {
    const { jobRepository, server } = buildJobsServer(noCreate, OWNER_ID, async () => transcript);

    const response = await getTranscript(server);

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ jobId: TRANSCRIPT_JOB_ID, ...transcript });
    expect(jobRepository.findOwnedTranscript).toHaveBeenCalledWith({
      jobId: TRANSCRIPT_JOB_ID,
      ownerId: OWNER_ID,
    });
  });

  it('결과가 없으면 404 transcript_not_found이고 no-store다', async () => {
    const { server } = buildJobsServer(noCreate);

    const response = await getTranscript(server);

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'transcript_not_found' });
  });

  it('uuid가 아닌 jobId는 400이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildJobsServer(noCreate);

    const response = await getTranscript(server, 'job-1');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(jobRepository.findOwnedTranscript).not.toHaveBeenCalled();
  });

  it('sub가 uuid가 아니면 401이고 repository를 호출하지 않는다', async () => {
    const { jobRepository, server } = buildJobsServer(noCreate, 'user-1');

    const response = await getTranscript(server);

    expect(response.statusCode).toBe(401);
    expect(jobRepository.findOwnedTranscript).not.toHaveBeenCalled();
  });

  it('저장소 일시 장애는 503, 예상 밖 오류는 500이다', async () => {
    const unavailable = buildJobsServer(noCreate, OWNER_ID, async () => {
      throw new JobStoreUnavailableError('timeout');
    });
    const unexpected = buildJobsServer(noCreate, OWNER_ID, async () => {
      throw new Error('select_transcripts invalid response');
    });

    const [unavailableResponse, unexpectedResponse] = await Promise.all([
      getTranscript(unavailable.server),
      getTranscript(unexpected.server),
    ]);

    expect(unavailableResponse.statusCode).toBe(503);
    expect(unexpectedResponse.statusCode).toBe(500);
  });

  it('어떤 응답 경로의 로그에도 토큰과 전사 본문이 남지 않는다', async () => {
    const outcomes: JobRepository['findOwnedTranscript'][] = [
      async () => transcript,
      async () => null,
      async () => {
        throw new JobStoreUnavailableError('network');
      },
      async () => {
        throw new Error('select_transcripts invalid response');
      },
    ];

    for (const findOwnedTranscript of outcomes) {
      const { logLines, server } = buildJobsServer(noCreate, OWNER_ID, findOwnedTranscript);

      await getTranscript(server);

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join('')).not.toContain(TOKEN);
      expect(logLines.join('')).not.toContain(SEGMENT_TEXT);
    }
  });
});
