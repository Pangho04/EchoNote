import { describe, expect, it } from 'vitest';

import { createJobRequestSchema, processingJobSchema, processingJobStatusSchema } from './index';

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
});

describe('createJobRequestSchema', () => {
  const request = {
    meetingId: '6f1c1f9e-8a3b-4c2d-9e5f-0a1b2c3d4e5f',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    mimeType: 'audio/mp4',
  };

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
