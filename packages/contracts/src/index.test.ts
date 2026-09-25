import { describe, expect, it } from 'vitest';

import {
  meetingSchema,
  transcriptReviewCandidateSchema,
  transcriptReviewQueueSchema,
  transcriptSegmentSchema,
} from './index';

const candidate = {
  confidence: 0.65,
  endMs: 2_000,
  id: 'candidate-1',
  originalText: '보안 결제',
  reason: '문맥상 고유 명사일 가능성',
  startMs: 1_000,
  suggestedText: '보안 정책',
};

describe('transcriptReviewQueueSchema', () => {
  it('정확히 20개의 후보를 허용한다', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      ...candidate,
      id: `candidate-${index}`,
    }));

    expect(transcriptReviewQueueSchema.safeParse(candidates).success).toBe(true);
  });

  it('사용자에게 보여 줄 후보를 최대 20건으로 제한한다', () => {
    const candidates = Array.from({ length: 21 }, (_, index) => ({
      ...candidate,
      id: `candidate-${index}`,
    }));

    expect(transcriptReviewQueueSchema.safeParse(candidates).success).toBe(false);
  });

  it('끝 시간이 시작 시간보다 빠른 후보를 거부한다', () => {
    const result = transcriptReviewCandidateSchema.safeParse({
      ...candidate,
      endMs: 1_000,
      startMs: 2_000,
    });

    expect(result.success).toBe(false);
  });
});

describe('meetingSchema', () => {
  it('유효하지 않은 날짜를 거부한다', () => {
    const result = meetingSchema.safeParse({
      createdAt: '오늘',
      durationMs: 1_000,
      id: 'meeting-1',
      title: '회의',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('transcriptSegmentSchema', () => {
  it('끝 시간이 시작 시간보다 빠른 구간을 거부한다', () => {
    const result = transcriptSegmentSchema.safeParse({
      endMs: 1_000,
      id: 'segment-1',
      speakerLabel: null,
      startMs: 2_000,
      text: '회의 내용',
    });

    expect(result.success).toBe(false);
  });
});
