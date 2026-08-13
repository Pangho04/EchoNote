import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MeetingRepository } from '@/entities/meeting';

import { getMeetingYearRangeMs, makeListMeetings } from './list-meetings';

describe('getMeetingYearRangeMs', () => {
  it.each([
    {
      expectedNext: '2027-01-01T00:00:00.000Z',
      expectedStart: '2026-01-01T00:00:00.000Z',
      timeZone: 'UTC',
    },
    {
      expectedNext: '2026-12-31T15:00:00.000Z',
      expectedStart: '2025-12-31T15:00:00.000Z',
      timeZone: 'Asia/Seoul',
    },
    {
      expectedNext: '2027-01-01T05:00:00.000Z',
      expectedStart: '2026-01-01T05:00:00.000Z',
      timeZone: 'America/New_York',
    },
  ])(
    '$timeZone의 2026년 현지 경계를 UTC 범위로 변환한다',
    ({ expectedNext, expectedStart, timeZone }) => {
      const range = getMeetingYearRangeMs(2026, timeZone);

      expect(new Date(range.yearStartMs).toISOString()).toBe(expectedStart);
      expect(new Date(range.nextYearStartMs).toISOString()).toBe(expectedNext);
    },
  );

  it('잘못된 time zone을 거부한다', () => {
    expect(() => getMeetingYearRangeMs(2026, 'Invalid/TimeZone')).toThrow(RangeError);
  });
});

describe('makeListMeetings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('기기 time zone의 연도 범위와 cursor를 repository query로 전달한다', async () => {
    const cursor = { createdAtMs: 1_767_225_600_000, meetingId: 'meeting-20' };
    const list = vi.fn(async () => ({ meetings: [], nextCursor: null }));
    const repository: MeetingRepository = {
      create: async () => {
        throw new Error('이 테스트에서는 create를 호출하지 않습니다.');
      },
      list,
    };
    const resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        calendar: 'gregory',
        locale: 'ko-KR',
        numberingSystem: 'latn',
        timeZone: 'Asia/Seoul',
      });
    const listMeetings = makeListMeetings(repository);

    const result = await listMeetings({ cursor, limit: 20, year: 2026 });

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      cursor,
      limit: 20,
      nextYearStartMs: Date.parse('2026-12-31T15:00:00.000Z'),
      yearStartMs: Date.parse('2025-12-31T15:00:00.000Z'),
    });
    expect(result).toEqual({ meetings: [], nextCursor: null, timeZone: 'Asia/Seoul' });
    expect(resolvedOptionsSpy).toHaveBeenCalledTimes(1);
  });
});
