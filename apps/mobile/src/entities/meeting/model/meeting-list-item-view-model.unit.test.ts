import { describe, expect, it } from 'vitest';

import { type Meeting, MeetingStatus } from './meeting';
import {
  extractMeetingDateLabels,
  formatMeetingDurationLabel,
  toMeetingListItemVM,
} from './meeting-list-item-view-model';
import { nomalizeMeetingTitle } from './nomalize-meeting-title';

describe('extractMeetingDateLabels', () => {
  it('ISO 시각을 한국 시간의 월·일 label로 변환한다', () => {
    expect(extractMeetingDateLabels('2026-09-21T14:00:00+09:00', 'Asia/Seoul')).toEqual({
      monthLabel: '9월',
      dayLabel: '21',
    });
  });

  it('UTC 시각의 날짜가 한국 시간에서 넘어가면 다음 날 label을 반환한다', () => {
    expect(extractMeetingDateLabels('2026-09-21T23:00:00Z', 'Asia/Seoul')).toEqual({
      monthLabel: '9월',
      dayLabel: '22',
    });
  });

  it('조회에 사용한 time zone 기준으로 월·일 label을 반환한다', () => {
    expect(extractMeetingDateLabels('2026-01-01T00:30:00Z', 'America/Los_Angeles')).toEqual({
      monthLabel: '12월',
      dayLabel: '31',
    });
  });
});

describe('nomalizeMeetingTitle', () => {
  it('앞뒤 공백을 제거한다', () => {
    expect(nomalizeMeetingTitle('  제품   회의  ', '2026-08-04T00:00:00.000Z', 'Asia/Seoul')).toBe(
      '제품 회의',
    );
  });

  it('제목을 최대 80자로 제한한다', () => {
    expect(
      nomalizeMeetingTitle('가'.repeat(81), '2026-08-04T00:00:00.000Z', 'Asia/Seoul'),
    ).toHaveLength(80);
  });

  it.each([
    {
      createdAt: '2025-12-31T15:30:00.000Z',
      expected: '2026-01-01 오전 12:30:00_녹음',
      timeZone: 'Asia/Seoul',
    },
    {
      createdAt: '2026-01-01T03:00:00.000Z',
      expected: '2025-12-31 오후 07:00:00_녹음',
      timeZone: 'America/Los_Angeles',
    },
  ])('공백뿐인 제목을 $timeZone 등록일 기반 기본 제목으로 바꾼다', (testCase) => {
    expect(nomalizeMeetingTitle('   ', testCase.createdAt, testCase.timeZone)).toBe(
      testCase.expected,
    );
  });

  it('잘못된 등록 시각과 time zone을 거부한다', () => {
    expect(() => nomalizeMeetingTitle('', 'invalid', 'Asia/Seoul')).toThrow(RangeError);
    expect(() => nomalizeMeetingTitle('', '2026-01-01T00:00:00.000Z', 'Invalid/Zone')).toThrow(
      RangeError,
    );
  });
});

describe('toMeetingListItemVM', () => {
  const meeting: Meeting = {
    id: 'meeting-1',
    title: '제품 로드맵 정기 회의',
    status: MeetingStatus.Completed,
    createdAt: '2026-08-04T09:00:00+09:00',
    updatedAt: '2026-08-04T09:52:00+09:00',
    durationMs: 52 * 60 * 1000,
  };

  it('Meeting을 목록 표시용 VM 한 건으로 변환한다', () => {
    expect(toMeetingListItemVM(meeting, 'Asia/Seoul')).toEqual({
      id: 'meeting-1',
      title: '제품 로드맵 정기 회의',
      monthLabel: '8월',
      dayLabel: '04',
      metaLabel: '52분 · 전사와 요약 완료',
      accessory: { kind: 'chip', label: '완료' },
    });
  });

  it('녹음 전 회의는 duration 없이 상태 설명만 표시한다', () => {
    expect(
      toMeetingListItemVM(
        {
          ...meeting,
          status: MeetingStatus.LocalOnly,
          durationMs: null,
        },
        'Asia/Seoul',
      ),
    ).toMatchObject({
      metaLabel: '녹음 대기',
      accessory: { kind: 'arrow' },
    });
  });

  it('updatedAt이 바뀌어도 createdAt 기준 날짜 label은 바뀌지 않는다', () => {
    const original = toMeetingListItemVM(meeting, 'Asia/Seoul');
    const updated = toMeetingListItemVM(
      { ...meeting, updatedAt: '2027-01-01T00:00:00.000Z' },
      'Asia/Seoul',
    );

    expect(updated.monthLabel).toBe(original.monthLabel);
    expect(updated.dayLabel).toBe(original.dayLabel);
  });
});

describe('formatMeetingDurationLabel', () => {
  it.each([
    { durationMs: 0, expected: '0분' },
    { durationMs: 52 * 60 * 1000, expected: '52분' },
    { durationMs: 60 * 60 * 1000, expected: '1시간' },
    { durationMs: 70 * 60 * 1000, expected: '1시간 10분' },
  ])('$durationMs ms를 $expected으로 변환한다', ({ durationMs, expected }) => {
    expect(formatMeetingDurationLabel(durationMs)).toBe(expected);
  });
});
