import { describe, expect, it } from 'vitest';

import { parseWhisperOutput, WhisperOutputParseError } from './parse-whisper-output.js';

const segment = (startMs: number, endMs: number, text = '안녕하세요') => ({ endMs, startMs, text });

const output = (overrides: Record<string, unknown> = {}) => ({
  durationMs: 10_000,
  schemaVersion: 1,
  segments: [segment(0, 1_000), segment(1_000, 2_500, '반갑습니다')],
  ...overrides,
});

describe('parseWhisperOutput', () => {
  it.each([
    ['segment 0개', output({ segments: [] })],
    ['segment 1개', output({ segments: [segment(0, 10_000)] })],
    ['segment 여러 개', output()],
    ['시작이 같은 segment', output({ segments: [segment(0, 0), segment(0, 500)] })],
    [
      '상한 경계',
      output({ durationMs: 6 * 60 * 60 * 1000, segments: [segment(0, 1, 'a'.repeat(2_000))] }),
    ],
  ])('%s는 그대로 돌려준다', (_label, raw) => {
    expect(parseWhisperOutput(raw)).toEqual(raw);
  });

  it.each([
    ['객체 아님', 'text'],
    ['schemaVersion 2', output({ schemaVersion: 2 })],
    ['모르는 최상위 키', output({ language: 'ko' })],
    ['모르는 segment 키', output({ segments: [{ ...segment(0, 1), words: [] }] })],
    ['durationMs 누락', output({ durationMs: undefined })],
    ['durationMs 음수', output({ durationMs: -1 })],
    ['durationMs 소수', output({ durationMs: 1.5 })],
    ['durationMs NaN', output({ durationMs: Number.NaN })],
    ['durationMs 6시간 초과', output({ durationMs: 6 * 60 * 60 * 1000 + 1 })],
    ['startMs 소수', output({ segments: [segment(0.5, 1)] })],
    ['startMs 음수', output({ segments: [segment(-1, 1)] })],
    ['end < start', output({ segments: [segment(500, 400)] })],
    ['end > duration', output({ segments: [segment(0, 10_001)] })],
    ['start 감소', output({ segments: [segment(1_000, 2_000), segment(999, 2_000)] })],
    ['빈 text', output({ segments: [segment(0, 1, '')] })],
    ['공백만 있는 text', output({ segments: [segment(0, 1, ' \n ')] })],
    ['text 2,000자 초과', output({ segments: [segment(0, 1, 'a'.repeat(2_001))] })],
    [
      'segment 20,000개 초과',
      output({ segments: Array.from({ length: 20_001 }, () => segment(0, 0)) }),
    ],
  ])('%s는 본문 없는 INVALID_WHISPER_OUTPUT으로 거부한다', (_label, raw) => {
    let caught: unknown;

    try {
      parseWhisperOutput(raw);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WhisperOutputParseError);
    expect(caught).toMatchObject({
      code: 'INVALID_WHISPER_OUTPUT',
      message: 'INVALID_WHISPER_OUTPUT',
    });
    expect((caught as Error).cause).toBeUndefined();
  });
});
