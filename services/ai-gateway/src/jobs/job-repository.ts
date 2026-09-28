import {
  createJobRequestSchema,
  type JobSnapshot,
  processingJobStatusSchema,
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

export type JobRepository = {
  createJob(input: CreateJobInput): Promise<CreateJobResult>;
};

// 저장소에 닿지 못했거나 저장소가 일시적으로 응답할 수 없을 때. 재시도할 수 있으므로 503으로 응답한다.
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

const toJobSnapshot = (row: z.infer<typeof jobRowSchema>): JobSnapshot => ({
  id: row.id,
  meetingId: row.meeting_id,
  status: row.status,
  sizeBytes: row.size_bytes,
  sha256: row.sha256,
  mimeType: row.mime_type,
  createdAt: new Date(row.created_at).toISOString(),
});

const callStore = async <T>(accessStore: () => Promise<T>) => {
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
    if (error instanceof SyntaxError) throw new Error('create_job_v1 invalid response');

    // eslint-disable-next-line preserve-caught-error -- 원본 message·cause에 무엇이 들었는지 알 수 없다.
    throw new Error('create_job_v1 unexpected error');
  }
};

export const createJobRepository = ({
  supabaseUrl,
  secretKey,
  timeoutMs,
}: JobRepositoryOptions): JobRepository => {
  const headers = new Headers({ apikey: secretKey, 'content-type': 'application/json' });

  return {
    async createJob(input) {
      const response = await callStore(async () =>
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

      if (!response.ok) {
        // 오류 body에는 SQL 오류 문구가 들 수 있어 읽지 않는다.
        response.body?.cancel().catch(() => undefined);

        if (UNAVAILABLE_STATUSES.has(response.status)) {
          throw new JobStoreUnavailableError(`http_${response.status}`);
        }

        throw new Error(`create_job_v1 http_${response.status}`);
      }

      const parsed = createJobRowSchema.safeParse(await callStore(async () => response.json()));

      if (!parsed.success) throw new Error('create_job_v1 invalid response');

      switch (parsed.data.kind) {
        case 'created':
        case 'existing':
          return { kind: parsed.data.kind, job: toJobSnapshot(parsed.data.job) };

        case 'conflict':
          return { kind: 'conflict' };
      }
    },
  };
};
