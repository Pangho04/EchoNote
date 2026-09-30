import { describe, expect, it } from 'vitest';

import { transcriptResultSchema } from './index';

const segment = (startMs: number, endMs: number, text = '안녕하세요') => ({ endMs, startMs, text });

const result = (overrides: Record<string, unknown> = {}) => ({
  durationMs: 10_000,
  segments: [segment(0, 1_000), segment(1_000, 2_500, '반갑습니다')],
  ...overrides,
});

describe('transcriptResultSchema', () => {
  it.each([
    ['segment 0개', result({ segments: [] })],
    ['시작이 같은 segment', result({ segments: [segment(0, 0), segment(0, 500)] })],
    ['짝 맞은 이모지', result({ segments: [segment(0, 1, '좋아요 😀')] })],
    [
      '상한 경계',
      result({ durationMs: 6 * 60 * 60 * 1000, segments: [segment(0, 1, 'a'.repeat(2_000))] }),
    ],
    [
      'segment 20,000개',
      result({ segments: Array.from({ length: 20_000 }, () => segment(0, 0, 'a')) }),
    ],
  ])('%s를 허용한다', (_label, raw) => {
    expect(transcriptResultSchema.safeParse(raw).success).toBe(true);
  });

  it.each([
    ['schemaVersion 섞임', result({ schemaVersion: 1 })],
    ['모르는 segment 키', result({ segments: [{ ...segment(0, 1), words: [] }] })],
    ['durationMs 6시간 초과', result({ durationMs: 6 * 60 * 60 * 1000 + 1 })],
    ['durationMs 소수', result({ durationMs: 1.5 })],
    ['end < start', result({ segments: [segment(500, 400)] })],
    ['end > duration', result({ segments: [segment(0, 10_001)] })],
    ['start 감소', result({ segments: [segment(1_000, 2_000), segment(999, 2_000)] })],
    ['빈 text', result({ segments: [segment(0, 1, '')] })],
    ['공백만 있는 text', result({ segments: [segment(0, 1, ' \n ')] })],
    ['text 2,000자 초과', result({ segments: [segment(0, 1, 'a'.repeat(2_001))] })],
    [
      'segment 20,000개 초과',
      result({ segments: Array.from({ length: 20_001 }, () => segment(0, 0, 'a')) }),
    ],
    ['NUL 포함 text', result({ segments: [segment(0, 1, 'a\u0000b')] })],
    ['짝 없는 high surrogate', result({ segments: [segment(0, 1, 'a\ud800')] })],
    ['짝 없는 low surrogate', result({ segments: [segment(0, 1, 'a\udc00b')] })],
  ])('%s를 거부한다', (_label, raw) => {
    expect(transcriptResultSchema.safeParse(raw).success).toBe(false);
  });
});
