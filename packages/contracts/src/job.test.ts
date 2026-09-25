import { describe, expect, it } from 'vitest';

import { processingJobSchema, processingJobStatusSchema } from './index';

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
