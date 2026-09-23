import { describe, expect, it, vi } from 'vitest';

import type { Meeting } from '@/entities/meeting/model/meeting';
import { MeetingStatus } from '@/entities/meeting/model/meeting';
import type { Recording } from '@/entities/recording/model/recording';

import { getMeetingDetail } from './get-meeting-detail';

const meetingId = 'meeting-1';

const meeting: Meeting = {
  id: meetingId,
  title: '주간 회의',
  status: MeetingStatus.LocalOnly,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 60_000,
};

const recording: Recording = {
  meetingId,
  uri: 'file:///recording.m4a',
  mimeType: 'audio/m4a',
  sha256: 'abc123',
  durationMs: 60_000,
  byteSize: 1_024,
};

describe('getMeetingDetail', () => {
  it('Meeting과 saved Recording이 둘 다 있으면 ready를 반환한다', async () => {
    const getByMeetingId = vi.fn(async () => meeting);
    const getSavedByMeetingId = vi.fn(async () => recording);
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'ready', meeting, recording });
    expect(getByMeetingId).toHaveBeenCalledTimes(1);
    expect(getByMeetingId).toHaveBeenCalledWith(meetingId);
    expect(getSavedByMeetingId).toHaveBeenCalledTimes(1);
    expect(getSavedByMeetingId).toHaveBeenCalledWith(meetingId);
  });

  it('Meeting이 없으면 not-found를 반환하고 Recording을 조회하지 않는다', async () => {
    const getByMeetingId = vi.fn(async () => null);
    const getSavedByMeetingId = vi.fn(async () => recording);
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'not-found' });
    expect(getSavedByMeetingId).not.toHaveBeenCalled();
  });

  it('Meeting은 있는데 saved Recording이 없으면 error다', async () => {
    const getByMeetingId = vi.fn(async () => meeting);
    const getSavedByMeetingId = vi.fn(async () => null);
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({
      kind: 'error',
      message: `회의 ${meetingId}에 저장된 녹음이 없습니다.`,
    });
  });

  it('Meeting 조회가 throw하면 error이고 message를 보존한다', async () => {
    const getByMeetingId = vi.fn(async () => {
      throw new Error('meeting 조회 실패');
    });
    const getSavedByMeetingId = vi.fn(async () => recording);
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'error', message: 'meeting 조회 실패' });
    expect(getSavedByMeetingId).not.toHaveBeenCalled();
  });

  it('Meeting은 resolve되고 Recording 조회가 throw하면 error이고 message를 보존한다', async () => {
    const getByMeetingId = vi.fn(async () => meeting);
    const getSavedByMeetingId = vi.fn(async () => {
      throw new Error('recording 조회 실패');
    });
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'error', message: 'recording 조회 실패' });
  });

  it('getByMeetingId가 Error가 아닌 문자열을 throw해도 error이고 String(error)가 message에 담긴다', async () => {
    const getByMeetingId = vi.fn(async () => {
      throw '문자열 에러';
    });
    const getSavedByMeetingId = vi.fn(async () => recording);
    const deps = {
      meetings: { getByMeetingId },
      recordings: { getSavedByMeetingId },
      recordingFileExists: () => true,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'error', message: String('문자열 에러') });
  });

  it('Recording 행은 있는데 파일이 없으면 recording-missing이다', async () => {
    const recordingFileExists = vi.fn(() => false);
    const deps = {
      meetings: { getByMeetingId: vi.fn(async () => meeting) },
      recordings: { getSavedByMeetingId: vi.fn(async () => recording) },
      recordingFileExists,
    };

    const result = await getMeetingDetail(deps, meetingId);

    expect(result).toEqual({ kind: 'recording-missing' });
    expect(recordingFileExists).toHaveBeenCalledWith(recording.uri);
  });
});
