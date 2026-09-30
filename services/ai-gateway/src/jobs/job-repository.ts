import {
  createJobRequestSchema,
  type JobFailureCode,
  jobFailureCodeSchema,
  type JobSnapshot,
  processingJobStatusSchema,
  type TranscriptResult,
  transcriptResultSchema,
  type UploadCompletionRequest,
} from '@echonote/contracts';
import { z } from 'zod';

type JobRepositoryOptions = {
  supabaseUrl: string;
  // loadEnvironment로 검증한 값만 받는다. new Headers의 TypeError 문구가 값을 담는다.
  secretKey: string;
  timeoutMs: number;
};

type CreateJobInput = {
  ownerId: string;
  idempotencyKey: string;
  meetingId: string;
  sizeBytes: number;
  sha256: string;
  mimeType: JobSnapshot['mimeType'];
};

export type CreateJobResult =
  | { kind: 'created'; job: JobSnapshot }
  | { kind: 'existing'; job: JobSnapshot }
  | { kind: 'conflict' };

export type CompleteUploadResult =
  | { kind: 'queued'; job: JobSnapshot }
  | { kind: 'existing'; job: JobSnapshot }
  | { kind: 'conflict' }
  | { kind: 'not_found' };

export type ClaimJobResult =
  | { kind: 'claimed'; job: JobSnapshot; lease: { leaseId: string; expiresAt: string } }
  | { kind: 'idle' };

export type RenewJobLeaseResult = { kind: 'renewed'; expiresAt: string } | { kind: 'stale' };

export type OwnedJob = JobSnapshot & { errorCode: JobFailureCode | null };

export type FailJobResult = { kind: 'failed' } | { kind: 'stale' };

export type CompleteJobResult = { kind: 'completed' } | { kind: 'stale' };

export type JobRepository = {
  createJob(input: CreateJobInput): Promise<CreateJobResult>;
  // 다른 owner의 job은 없는 job과 같이 not_found다.
  completeUpload(input: UploadCompletionRequest): Promise<CompleteUploadResult>;
  // 다른 owner의 job은 없는 job과 같이 null이다.
  findOwnedJob(input: { ownerId: string; jobId: string }): Promise<OwnedJob | null>;
  claimJob(): Promise<ClaimJobResult>;
  // 없는 job, 다른 lease_id, 기한 지난 lease는 모두 stale이다.
  renewJobLease(input: { jobId: string; leaseId: string }): Promise<RenewJobLeaseResult>;
  // renewJobLease와 같은 조건의 lease만 failed로 확정한다. 나머지는 stale이다.
  failJob(input: {
    jobId: string;
    leaseId: string;
    errorCode: JobFailureCode;
  }): Promise<FailJobResult>;
  // renewJobLease와 같은 조건의 lease만 전사 결과를 저장하며 completed로 확정한다. 나머지는 stale이다.
  completeJob(input: {
    jobId: string;
    leaseId: string;
    transcript: TranscriptResult;
  }): Promise<CompleteJobResult>;
  // 다른 owner의 전사와 아직 완료되지 않은 job은 없는 전사와 같이 null이다.
  findOwnedTranscript(input: { ownerId: string; jobId: string }): Promise<TranscriptResult | null>;
};

// 저장소에 닿지 못했거나 저장소가 일시적으로 응답할 수 없을 때. 재시도할 수 있는 장애로 분류한다.
// reason에는 분류 코드만 담고 응답 body·key는 담지 않는다.
export class JobStoreUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('job store unavailable');
    this.name = 'JobStoreUnavailableError';
    this.reason = reason;
  }
}

const UNAVAILABLE_STATUSES = new Set([429, 502, 503, 504]);

const jobRowSchema = z.object({
  id: z.uuid(),
  meeting_id: z.uuid(),
  status: processingJobStatusSchema,
  size_bytes: createJobRequestSchema.shape.sizeBytes,
  sha256: createJobRequestSchema.shape.sha256,
  mime_type: createJobRequestSchema.shape.mimeType,
  created_at: z.iso.datetime({ offset: true }),
});

const createJobRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), job: jobRowSchema }),
  z.object({ kind: z.literal('existing'), job: jobRowSchema }),
  z.object({ kind: z.literal('conflict') }),
]);

const completeUploadRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queued'), job: jobRowSchema }),
  z.object({ kind: z.literal('existing'), job: jobRowSchema }),
  z.object({ kind: z.literal('conflict') }),
  z.object({ kind: z.literal('not_found') }),
]);

const claimJobRowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('claimed'),
    job: jobRowSchema,
    lease: z.object({ lease_id: z.uuid(), expires_at: z.iso.datetime({ offset: true }) }),
  }),
  z.object({ kind: z.literal('idle') }),
]);

const renewJobLeaseRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('renewed'), expires_at: z.iso.datetime({ offset: true }) }),
  z.object({ kind: z.literal('stale') }),
]);

const failJobRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('failed') }),
  z.object({ kind: z.literal('stale') }),
]);

const completeJobRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed') }),
  z.object({ kind: z.literal('stale') }),
]);

// 열 형태만 먼저 확인하고 내용 규칙은 camelCase로 옮긴 뒤 계약으로 검사한다.
const transcriptRowsSchema = z
  .array(z.object({ duration_ms: z.unknown(), segments: z.unknown() }))
  .max(1);

const toJobSnapshot = (row: z.infer<typeof jobRowSchema>): JobSnapshot => ({
  id: row.id,
  meetingId: row.meeting_id,
  status: row.status,
  sizeBytes: row.size_bytes,
  sha256: row.sha256,
  mimeType: row.mime_type,
  createdAt: new Date(row.created_at).toISOString(),
});

const ownedJobRowSchema = jobRowSchema.extend({ error_code: jobFailureCodeSchema.nullable() });

const OWNED_JOB_COLUMNS = 'id,meeting_id,status,size_bytes,sha256,mime_type,created_at,error_code';

// label은 오류 문구에서 어느 저장소 호출이 실패했는지만 구분한다.
const callStore = async <T>(label: string, accessStore: () => Promise<T>) => {
  try {
    return await accessStore();
  } catch (error) {
    // AbortSignal.timeout이 만료되면 fetch·body 읽기는 name이 TimeoutError인 DOMException으로 reject한다.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new JobStoreUnavailableError('timeout');
    }

    // fetch는 연결 실패·body 읽기 중단을 TypeError로 reject한다.
    if (error instanceof TypeError) throw new JobStoreUnavailableError('network');

    // eslint-disable-next-line preserve-caught-error -- 원본 오류가 응답 body 조각을 담을 수 있다.
    if (error instanceof SyntaxError) throw new Error(`${label} invalid response`);

    // eslint-disable-next-line preserve-caught-error -- 원본 message·cause에 무엇이 들었는지 알 수 없다.
    throw new Error(`${label} unexpected error`);
  }
};

const ensureOk = (label: string, response: Response) => {
  if (response.ok) return;

  // 오류 body에는 SQL 오류 문구가 들 수 있어 읽지 않는다.
  response.body?.cancel().catch(() => undefined);

  if (UNAVAILABLE_STATUSES.has(response.status)) {
    throw new JobStoreUnavailableError(`http_${response.status}`);
  }

  throw new Error(`${label} http_${response.status}`);
};

export const createJobRepository = ({
  supabaseUrl,
  secretKey,
  timeoutMs,
}: JobRepositoryOptions): JobRepository => {
  const headers = new Headers({ apikey: secretKey, 'content-type': 'application/json' });

  return {
    async createJob(input) {
      const response = await callStore('create_job_v1', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/create_job_v1`, {
          body: JSON.stringify({
            p_owner_id: input.ownerId,
            p_idempotency_key: input.idempotencyKey,
            p_meeting_id: input.meetingId,
            p_size_bytes: input.sizeBytes,
            p_sha256: input.sha256,
            p_mime_type: input.mimeType,
          }),
          headers,
          method: 'POST',
          // 3xx를 따라가면 apikey가 다른 origin으로 갈 수 있다. non-2xx로 처리한다.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('create_job_v1', response);

      const parsed = createJobRowSchema.safeParse(
        await callStore('create_job_v1', async () => response.json()),
      );

      if (!parsed.success) throw new Error('create_job_v1 invalid response');

      switch (parsed.data.kind) {
        case 'created':
        case 'existing':
          return { kind: parsed.data.kind, job: toJobSnapshot(parsed.data.job) };

        case 'conflict':
          return { kind: 'conflict' };
      }
    },

    async completeUpload(input) {
      const response = await callStore('complete_upload_v1', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/complete_upload_v1`, {
          body: JSON.stringify({
            p_job_id: input.jobId,
            p_owner_id: input.ownerId,
            p_size_bytes: input.sizeBytes,
            p_sha256: input.sha256,
            p_mime_type: input.mimeType,
          }),
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('complete_upload_v1', response);

      const parsed = completeUploadRowSchema.safeParse(
        await callStore('complete_upload_v1', async () => response.json()),
      );

      if (!parsed.success) throw new Error('complete_upload_v1 invalid response');

      switch (parsed.data.kind) {
        case 'queued':
        case 'existing':
          return { kind: parsed.data.kind, job: toJobSnapshot(parsed.data.job) };

        case 'conflict':
        case 'not_found':
          return { kind: parsed.data.kind };
      }
    },

    async findOwnedJob({ jobId, ownerId }) {
      const query = new URLSearchParams({
        id: `eq.${jobId}`,
        owner_id: `eq.${ownerId}`,
        select: OWNED_JOB_COLUMNS,
      });
      const response = await callStore('select_jobs', async () =>
        fetch(`${supabaseUrl}/rest/v1/jobs?${query}`, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('select_jobs', response);

      // (id)가 primary key라 2건 이상은 저장소 응답 이상이다.
      const parsed = z
        .array(ownedJobRowSchema)
        .max(1)
        .safeParse(await callStore('select_jobs', async () => response.json()));

      if (!parsed.success) throw new Error('select_jobs invalid response');

      const [row] = parsed.data;

      return row === undefined ? null : { ...toJobSnapshot(row), errorCode: row.error_code };
    },

    async claimJob() {
      const response = await callStore('claim_job_v1', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/claim_job_v1`, {
          body: '{}',
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('claim_job_v1', response);

      const parsed = claimJobRowSchema.safeParse(
        await callStore('claim_job_v1', async () => response.json()),
      );

      if (!parsed.success) throw new Error('claim_job_v1 invalid response');

      switch (parsed.data.kind) {
        case 'claimed':
          return {
            kind: 'claimed',
            job: toJobSnapshot(parsed.data.job),
            lease: {
              leaseId: parsed.data.lease.lease_id,
              expiresAt: new Date(parsed.data.lease.expires_at).toISOString(),
            },
          };

        case 'idle':
          return { kind: 'idle' };
      }
    },

    async renewJobLease({ jobId, leaseId }) {
      const response = await callStore('renew_job_lease_v1', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/renew_job_lease_v1`, {
          body: JSON.stringify({ p_job_id: jobId, p_lease_id: leaseId }),
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('renew_job_lease_v1', response);

      const parsed = renewJobLeaseRowSchema.safeParse(
        await callStore('renew_job_lease_v1', async () => response.json()),
      );

      if (!parsed.success) throw new Error('renew_job_lease_v1 invalid response');

      switch (parsed.data.kind) {
        case 'renewed':
          return { kind: 'renewed', expiresAt: new Date(parsed.data.expires_at).toISOString() };

        case 'stale':
          return { kind: 'stale' };
      }
    },

    async failJob({ errorCode, jobId, leaseId }) {
      const response = await callStore('fail_job_v2', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/fail_job_v2`, {
          body: JSON.stringify({ p_job_id: jobId, p_lease_id: leaseId, p_error_code: errorCode }),
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('fail_job_v2', response);

      const parsed = failJobRowSchema.safeParse(
        await callStore('fail_job_v2', async () => response.json()),
      );

      if (!parsed.success) throw new Error('fail_job_v2 invalid response');

      return { kind: parsed.data.kind };
    },

    async completeJob({ jobId, leaseId, transcript }) {
      const response = await callStore('complete_job_v1', async () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/complete_job_v1`, {
          body: JSON.stringify({
            p_job_id: jobId,
            p_lease_id: leaseId,
            p_duration_ms: transcript.durationMs,
            p_segments: transcript.segments,
          }),
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('complete_job_v1', response);

      const parsed = completeJobRowSchema.safeParse(
        await callStore('complete_job_v1', async () => response.json()),
      );

      if (!parsed.success) throw new Error('complete_job_v1 invalid response');

      return { kind: parsed.data.kind };
    },

    async findOwnedTranscript({ jobId, ownerId }) {
      const query = new URLSearchParams({
        job_id: `eq.${jobId}`,
        owner_id: `eq.${ownerId}`,
        select: 'duration_ms,segments',
      });
      const response = await callStore('select_transcripts', async () =>
        fetch(`${supabaseUrl}/rest/v1/transcripts?${query}`, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );

      ensureOk('select_transcripts', response);

      // (job_id)가 primary key라 2건 이상은 저장소 응답 이상이다.
      const rows = transcriptRowsSchema.safeParse(
        await callStore('select_transcripts', async () => response.json()),
      );

      if (!rows.success) throw new Error('select_transcripts invalid response');

      const [row] = rows.data;

      if (row === undefined) return null;

      const transcript = transcriptResultSchema.safeParse({
        durationMs: row.duration_ms,
        segments: row.segments,
      });

      if (!transcript.success) throw new Error('select_transcripts invalid response');

      return transcript.data;
    },
  };
};
