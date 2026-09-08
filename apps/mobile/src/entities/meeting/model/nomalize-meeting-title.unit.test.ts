import { describe, expect, it } from 'vitest';

import { nomalizeMeetingTitle } from './nomalize-meeting-title';

describe('nomalizeMeetingTitle 새 기본 제목 포맷', () => {
  it('공백 제목을 ko-KR 오전/오후 + 초 포함 포맷으로 만든다', () => {
    expect(nomalizeMeetingTitle('', '2025-12-31T15:30:00.000Z', 'Asia/Seoul')).toBe(
      '2026-01-01 오전 12:30:00_녹음',
    );
  });

  it('오후 시각은 오후 label과 12시간제로 나타낸다', () => {
    expect(nomalizeMeetingTitle('', '2026-01-01T03:00:00.000Z', 'America/Los_Angeles')).toBe(
      '2025-12-31 오후 07:00:00_녹음',
    );
  });

  it('실제 제목은 그대로 반환한다', () => {
    expect(nomalizeMeetingTitle('  정기 회의  ', '2026-01-01T00:00:00.000Z', 'Asia/Seoul')).toBe(
      '정기 회의',
    );
  });
});
