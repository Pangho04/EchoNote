import { describe, expect, it } from 'vitest';

import { findActiveSegmentIndex, type TranscriptSegment } from './transcription';

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 5_000, text: '첫 문장' },
  { startMs: 6_000, endMs: 10_000, text: '둘째 문장' },
  { startMs: 19_000, endMs: 25_000, text: '셋째 문장' },
];

describe('findActiveSegmentIndex', () => {
  it.each([
    [0, -1],
    [1, 0],
    [5_500, 0],
    [6_000, 1],
    [18_999, 1],
    [60_000, 2],
  ])('위치 %dms면 %d번 문장이다', (positionMs, expected) => {
    expect(findActiveSegmentIndex(segments, positionMs)).toBe(expected);
  });

  it('첫 문장 이전 위치면 -1이다', () => {
    expect(findActiveSegmentIndex(segments.slice(1), 3_000)).toBe(-1);
  });
});
