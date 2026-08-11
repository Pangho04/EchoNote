import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Meeting, MeetingStatus } from '../../../entities/meeting/model/meeting';
import type {
  CreateMeetingParams,
  MeetingRepository,
} from '../../../entities/meeting/model/meeting-repository';
import { makeCreateMeeting } from './create-meeting';

const { normalizeTitle } = vi.hoisted(() => ({
  normalizeTitle: vi.fn(() => '정규화된 제목'),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'meeting-uuid'),
}));

vi.mock('@/entities/meeting', () => ({
  nomalizeMeetingTitle: normalizeTitle,
}));

describe('makeCreateMeeting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T01:02:03.000Z'));
    normalizeTitle.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('호출 시점의 UUID·시각·정규화한 제목으로 repository create를 호출한다', async () => {
    const create = vi.fn(async (params: CreateMeetingParams): Promise<Meeting> => ({
      id: params.meetingId,
      title: params.title,
      status: MeetingStatus.LocalOnly,
      startedAt: params.startedAt,
      createdAt: params.requestedAt,
      updatedAt: params.requestedAt,
      durationMs: null,
    }));
    const repository: MeetingRepository = {
      create,
      list: async () => ({ meetings: [], nextCursor: null }),
    };
    const createMeeting = makeCreateMeeting({ repository });

    const result = await createMeeting('  제품 회의  ');

    expect(normalizeTitle).toHaveBeenCalledWith('  제품 회의  ', '2026-08-11T01:02:03.000Z');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      meetingId: 'meeting-uuid',
      title: '정규화된 제목',
      startedAt: '2026-08-11T01:02:03.000Z',
      requestedAt: '2026-08-11T01:02:03.000Z',
    });
    expect(result).toMatchObject({
      id: 'meeting-uuid',
      title: '정규화된 제목',
    });
  });
});
