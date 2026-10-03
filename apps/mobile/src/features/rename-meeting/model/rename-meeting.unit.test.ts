import { describe, expect, it, vi } from 'vitest';

import { MeetingNotFoundError } from '@/entities/meeting/model/meeting-repository';

import { normalizeMeetingRenameTitle, renameMeeting } from './rename-meeting';

describe('normalizeMeetingRenameTitle', () => {
  it('앞뒤 공백을 trim하고 연속 공백을 1칸으로 줄인다', () => {
    expect(normalizeMeetingRenameTitle('  제품   로드맵  회의  ')).toBe('제품 로드맵 회의');
  });

  it('80자를 넘으면 자른다', () => {
    const longTitle = 'A'.repeat(90);

    expect(normalizeMeetingRenameTitle(longTitle)).toBe('A'.repeat(80));
  });
});

describe('renameMeeting', () => {
  it('정규화한 title과 now()를 repository.rename에 전달한다', async () => {
    const rename = vi.fn(async () => undefined);
    const now = vi.fn(() => '2026-08-09T00:00:00.000Z');

    await renameMeeting(
      { repository: { rename }, now },
      { meetingId: 'meeting-1', title: '  새   제목  ' },
    );

    expect(rename).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      title: '새 제목',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
  });

  it('repository.rename의 MeetingNotFoundError를 그대로 전파한다', async () => {
    const rename = vi.fn(async () => {
      throw new MeetingNotFoundError('회의를 찾을 수 없습니다: meeting-1');
    });
    const now = vi.fn(() => '2026-08-09T00:00:00.000Z');

    await expect(
      renameMeeting({ repository: { rename }, now }, { meetingId: 'meeting-1', title: '새 제목' }),
    ).rejects.toThrow(MeetingNotFoundError);
  });
});
