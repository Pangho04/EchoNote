import {
  type JobSnapshot,
  jobSnapshotSchema,
  type ProcessingJob,
  processingJobSchema,
  transcriptResultSchema,
  type UploadGrantResponse,
  uploadGrantResponseSchema,
} from '@echonote/contracts';
import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';

import type { Recording } from '@/entities/recording';
import type { TranscriptContent } from '@/entities/transcript';

// aborted는 화면이 끊은 요청이라 호출자가 결과를 반영하지 않는다.
export type GatewayResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http-error'; status: number; error: string | null }
  | { kind: 'network-error' }
  | { kind: 'invalid-response' }
  | { kind: 'aborted' };

export type TranscriptionGateway = {
  createJob(recording: Recording, idempotencyKey: string): Promise<GatewayResult<JobSnapshot>>;
  issueUploadGrant(jobId: string): Promise<GatewayResult<UploadGrantResponse>>;
  getJob(
    meetingId: string,
    jobId: string,
    signal: AbortSignal,
  ): Promise<GatewayResult<ProcessingJob>>;
  getTranscript(jobId: string, signal: AbortSignal): Promise<GatewayResult<TranscriptContent>>;
};

// 전사 본문은 길어 기본 10초로는 모자랄 수 있다.
const TRANSCRIPT_TIMEOUT_MS = 30_000;

const errorBodySchema = z.object({ error: z.string() });

// Gateway가 jobId·segment 부가 필드를 더해도 받도록 필요한 필드만 골라 계약 스키마로 검증한다.
const transcriptBodySchema = z.object({
  durationMs: z.unknown(),
  segments: z.array(z.object({ startMs: z.unknown(), endMs: z.unknown(), text: z.unknown() })),
});

async function send<T>(
  request: () => Promise<{ data: unknown }>,
  parse: (data: unknown) => T | null,
): Promise<GatewayResult<T>> {
  try {
    const response = await request();
    const data = parse(response.data);

    return data === null ? { kind: 'invalid-response' } : { kind: 'ok', data };
  } catch (error) {
    if (axios.isCancel(error)) return { kind: 'aborted' };

    if (axios.isAxiosError(error) && error.response) {
      const body = errorBodySchema.safeParse(error.response.data);

      return {
        kind: 'http-error',
        status: error.response.status,
        error: body.success ? body.data.error : null,
      };
    }

    return { kind: 'network-error' };
  }
}

function parseWith<T>(schema: z.ZodType<T>) {
  return (data: unknown): T | null => {
    const result = schema.safeParse(data);

    return result.success ? result.data : null;
  };
}

export function createTranscriptionGateway(client: AxiosInstance): TranscriptionGateway {
  return {
    createJob(recording, idempotencyKey) {
      return send(
        () =>
          client.post(
            '/v1/jobs',
            {
              meetingId: recording.meetingId,
              sizeBytes: recording.byteSize,
              sha256: recording.sha256,
              mimeType: recording.mimeType,
            },
            { headers: { 'Idempotency-Key': idempotencyKey } },
          ),
        parseWith(jobSnapshotSchema),
      );
    },

    // Gateway는 body가 있으면 400이라 data를 넘기지 않는다.
    issueUploadGrant(jobId) {
      return send(
        () => client.post(`/v1/jobs/${jobId}/upload-grants`),
        (data) => {
          const grant = parseWith(uploadGrantResponseSchema)(data);

          return grant?.uploadUrl.startsWith('https://') ? grant : null;
        },
      );
    },

    getJob(meetingId, jobId, signal) {
      return send(
        () => client.get(`/v1/jobs/${jobId}`, { signal }),
        (data) => {
          const job = parseWith(processingJobSchema)(data);

          return job?.id === jobId && job.meetingId === meetingId ? job : null;
        },
      );
    },

    getTranscript(jobId, signal) {
      return send(
        () =>
          client.get(`/v1/jobs/${jobId}/transcript`, { signal, timeout: TRANSCRIPT_TIMEOUT_MS }),
        (data) => {
          const body = transcriptBodySchema.safeParse(data);

          return body.success ? parseWith(transcriptResultSchema)(body.data) : null;
        },
      );
    },
  };
}
