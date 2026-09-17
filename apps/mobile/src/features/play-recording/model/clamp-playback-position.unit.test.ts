import { describe, expect, it } from 'vitest';

import { clampPlaybackPosition } from './clamp-playback-position';

describe('clampPlaybackPosition', () => {
  it.each([
    ['5초에서 -10초는 0', { positionMs: 5_000, deltaMs: -10_000, durationMs: 60_000 }, 0],
    [
      '끝 3초 전에서 +10초는 끝',
      { positionMs: 57_000, deltaMs: 10_000, durationMs: 60_000 },
      60_000,
    ],
    ['중간 +10초', { positionMs: 20_000, deltaMs: 10_000, durationMs: 60_000 }, 30_000],
    ['중간 -10초', { positionMs: 20_000, deltaMs: -10_000, durationMs: 60_000 }, 10_000],
    ['duration 0이면 항상 0', { positionMs: 0, deltaMs: 10_000, durationMs: 0 }, 0],
    [
      '정확히 끝에서 +10초는 끝',
      { positionMs: 60_000, deltaMs: 10_000, durationMs: 60_000 },
      60_000,
    ],
  ])('%s', (_label, input, expected) => {
    expect(clampPlaybackPosition(input)).toBe(expected);
  });

  it.each([
    ['positionMs NaN', { positionMs: Number.NaN, deltaMs: 10_000, durationMs: 60_000 }],
    ['deltaMs Infinity', { positionMs: 0, deltaMs: Number.POSITIVE_INFINITY, durationMs: 60_000 }],
    ['durationMs -Infinity', { positionMs: 0, deltaMs: 0, durationMs: Number.NEGATIVE_INFINITY }],
    ['durationMs 음수', { positionMs: 0, deltaMs: 0, durationMs: -1 }],
  ])('%s면 RangeError', (_label, input) => {
    expect(() => clampPlaybackPosition(input)).toThrow(RangeError);
  });
});
