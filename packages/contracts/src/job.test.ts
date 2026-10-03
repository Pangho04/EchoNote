import { describe, expect, it } from 'vitest';

import {
  claimJobResponseSchema,
  completeJobRequestSchema,
  createJobRequestSchema,
  failJobRequestSchema,
  jobLeaseRequestSchema,
  MAX_UPLOAD_BYTES,
  processingJobSchema,
  processingJobStatusSchema,
  renewJobLeaseResponseSchema,
} from './index';

describe('processingJobStatusSchema', () => {
  it.each(['created', 'queued', 'processing', 'completed', 'failed'])(
    '%s 상태를 허용한다',
    (status) => {
      expect(processingJobStatusSchema.safeParse(status).success).toBe(true);
    },
  );

  it.each([
    'waiting_for_node',
    'uploading',
    'transcribing',
    'reviewing',
    'summarizing',
    'cancelled',
  ])('옛 상태 %s를 거부한다', (status) => {
    expect(processingJobStatusSchema.safeParse(status).success).toBe(false);
  });

  it.each(['', 'QUEUED', 'unknown'])('알 수 없는 값 %s를 거부한다', (status) => {
    expect(processingJobStatusSchema.safeParse(status).success).toBe(false);
  });
});

describe('processingJobSchema', () => {
  it('정상 작업을 허용하고 빈 meetingId를 거부한다', () => {
    const job = {
      errorCode: null,
      id: 'job-1',
      meetingId: 'meeting-1',
      status: 'queued',
    };

    expect(processingJobSchema.safeParse(job).success).toBe(true);
    expect(processingJobSchema.safeParse({ ...job, meetingId: '' }).success).toBe(false);
  });

  it('목록에 있는 errorCode만 허용한다', () => {
    const job = { id: 'job-1', meetingId: 'meeting-1', status: 'failed' };

    expect(processingJobSchema.safeParse({ ...job, errorCode: 'stt_failed' }).success).toBe(true);
    expect(processingJobSchema.safeParse({ ...job, errorCode: 'STT_EXIT' }).success).toBe(false);
  });
});

describe('createJobRequestSchema', () => {
  const request = {
    meetingId: '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    mimeType: 'audio/mp4',
  };

  it('MAX_UPLOAD_BYTES는 512 MiB다', () => {
    expect(MAX_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
  });

  it.each([1, 536_870_912])('sizeBytes %d를 허용한다', (sizeBytes) => {
    expect(createJobRequestSchema.safeParse({ ...request, sizeBytes }).success).toBe(true);
  });

  it.each([
    ['sizeBytes 0', { sizeBytes: 0 }],
    ['sizeBytes 536870913', { sizeBytes: 536_870_913 }],
    ['대문자 sha256', { sha256: 'A'.repeat(64) }],
    ['63자 sha256', { sha256: 'a'.repeat(63) }],
    ['65자 sha256', { sha256: 'a'.repeat(65) }],
    ['uuid가 아닌 meetingId', { meetingId: 'meeting-1' }],
    ['audio/mpeg', { mimeType: 'audio/mpeg' }],
    ['추가 필드', { ownerId: '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f' }],
  ])('%s를 거부한다', (_label, override) => {
    expect(createJobRequestSchema.safeParse({ ...request, ...override }).success).toBe(false);
  });
});

describe('jobLeaseRequestSchema', () => {
  const leaseId = '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f';

  it('uuid leaseId만 허용한다', () => {
    expect(jobLeaseRequestSchema.safeParse({ leaseId }).success).toBe(true);
    expect(jobLeaseRequestSchema.safeParse({ leaseId: 'lease-1' }).success).toBe(false);
    expect(jobLeaseRequestSchema.safeParse({}).success).toBe(false);
  });

  it('정의하지 않은 필드를 거부한다', () => {
    expect(jobLeaseRequestSchema.safeParse({ leaseId, status: 'failed' }).success).toBe(false);
  });
});

describe('failJobRequestSchema', () => {
  const leaseId = '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f';

  it.each(['audio_missing', 'stt_unavailable', 'stt_failed', 'result_rejected', 'unexpected'])(
    'errorCode %s를 허용한다',
    (errorCode) => {
      expect(failJobRequestSchema.safeParse({ errorCode, leaseId }).success).toBe(true);
    },
  );

  it.each([
    ['DB만 쓰는 attempts_exhausted', { errorCode: 'attempts_exhausted', leaseId }],
    ['목록 밖 errorCode', { errorCode: 'STT_EXIT', leaseId }],
    ['errorCode 없음', { leaseId }],
    ['추가 필드', { errorCode: 'stt_failed', leaseId, status: 'failed' }],
  ])('%s를 거부한다', (_label, body) => {
    expect(failJobRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('completeJobRequestSchema', () => {
  const leaseId = '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f';
  const transcript = { durationMs: 2_000, segments: [{ endMs: 1_000, startMs: 0, text: '안녕' }] };

  it('uuid leaseId와 전사 결과만 허용한다', () => {
    expect(completeJobRequestSchema.safeParse({ leaseId, transcript }).success).toBe(true);
    expect(completeJobRequestSchema.safeParse({ leaseId: 'lease-1', transcript }).success).toBe(
      false,
    );
    expect(completeJobRequestSchema.safeParse({ leaseId }).success).toBe(false);
  });

  it('정의하지 않은 필드와 schemaVersion 섞인 전사를 거부한다', () => {
    expect(completeJobRequestSchema.safeParse({ leaseId, status: 'x', transcript }).success).toBe(
      false,
    );
    expect(
      completeJobRequestSchema.safeParse({
        leaseId,
        transcript: { ...transcript, schemaVersion: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('claimJobResponseSchema', () => {
  const response = {
    job: {
      createdAt: '2026-09-29T12:00:00.123Z',
      id: '00000000-0000-4000-8000-0000000000f1',
      meetingId: '00000000-0000-4000-8000-00000000000c',
      mimeType: 'audio/mp4',
      sha256: 'e'.repeat(64),
      sizeBytes: 100,
      status: 'processing',
    },
    lease: {
      expiresAt: '2026-09-29T12:05:00.000Z',
      leaseId: '00000000-0000-4000-8000-0000000001f1',
    },
  };

  it('Gateway claim 응답을 허용하고 추가 필드를 거부하지 않는다', () => {
    expect(claimJobResponseSchema.safeParse(response).success).toBe(true);
    expect(claimJobResponseSchema.safeParse({ ...response, extra: 1 }).success).toBe(true);
  });

  it.each([
    ['uuid가 아닌 leaseId', { lease: { ...response.lease, leaseId: 'lease-1' } }],
    ['ISO가 아닌 기한', { lease: { ...response.lease, expiresAt: 'soon' } }],
    ['uuid가 아닌 job id', { job: { ...response.job, id: 'job-1' } }],
    ['sizeBytes 누락', { job: { ...response.job, sizeBytes: undefined } }],
  ])('%s를 거부한다', (_label, override) => {
    expect(claimJobResponseSchema.safeParse({ ...response, ...override }).success).toBe(false);
  });
});

describe('renewJobLeaseResponseSchema', () => {
  it('ISO 기한만 허용한다', () => {
    expect(
      renewJobLeaseResponseSchema.safeParse({ expiresAt: '2026-09-29T12:05:00.000Z' }).success,
    ).toBe(true);
    expect(renewJobLeaseResponseSchema.safeParse({ expiresAt: 'soon' }).success).toBe(false);
  });

  it('Gateway가 더한 필드는 거부하지 않는다', () => {
    expect(
      renewJobLeaseResponseSchema.safeParse({ expiresAt: '2026-09-29T12:05:00.000Z', extra: 1 })
        .success,
    ).toBe(true);
  });
});
