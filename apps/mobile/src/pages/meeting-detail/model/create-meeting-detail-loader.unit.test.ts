import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { createSQLiteMeetingRepository } from '@/entities/meeting';
import { createSQLiteRecordingRepository, recordingFileExists } from '@/entities/recording';
import { getMeetingDetail } from '@/features/get-meeting-detail';
import { renameMeeting } from '@/features/rename-meeting';

import {
  createMeetingDetailLoader,
  createMeetingTitleCommands,
} from './create-meeting-detail-loader';

vi.mock('@/entities/meeting', () => ({ createSQLiteMeetingRepository: vi.fn() }));
vi.mock('@/entities/recording', () => ({
  createSQLiteRecordingRepository: vi.fn(),
  recordingFileExists: vi.fn(),
}));
vi.mock('@/features/get-meeting-detail', () => ({ getMeetingDetail: vi.fn() }));
// 배럴이 RN 편집기 컴포넌트를 함께 내보내 node에서 실제 모듈을 읽지 않는다.
vi.mock('@/features/rename-meeting', () => ({ renameMeeting: vi.fn() }));

describe('createMeetingDetailLoader', () => {
  it('두 SQLite repository를 같은 database로 만들어 조회 기능에 주입한다', async () => {
    const database = {} as SQLiteDatabase;
    const meetings = { getByMeetingId: vi.fn() };
    const recordings = { getSavedByMeetingId: vi.fn() };

    vi.mocked(createSQLiteMeetingRepository).mockReturnValue(
      meetings as unknown as ReturnType<typeof createSQLiteMeetingRepository>,
    );
    vi.mocked(createSQLiteRecordingRepository).mockReturnValue(recordings);
    vi.mocked(getMeetingDetail).mockResolvedValue({ kind: 'not-found' });

    const load = createMeetingDetailLoader(database);
    const result = await load('meeting-1');

    expect(createSQLiteMeetingRepository).toHaveBeenCalledWith(database);
    expect(createSQLiteRecordingRepository).toHaveBeenCalledWith(database);
    expect(getMeetingDetail).toHaveBeenCalledWith(
      { meetings, recordings, recordingFileExists },
      'meeting-1',
    );
    expect(result).toEqual({ kind: 'not-found' });
  });
});

describe('createMeetingTitleCommands', () => {
  it('회의 행 조회와 이름 수정 기능에 같은 meetings repository를 주입한다', async () => {
    const database = {} as SQLiteDatabase;
    const saved = { id: 'meeting-1', title: '새 제목' };
    const meetings = { getByMeetingId: vi.fn(async () => saved) };

    vi.mocked(createSQLiteMeetingRepository).mockReturnValue(
      meetings as unknown as ReturnType<typeof createSQLiteMeetingRepository>,
    );
    vi.mocked(renameMeeting).mockResolvedValue();

    const commands = createMeetingTitleCommands(database);

    await expect(commands.loadMeeting('meeting-1')).resolves.toBe(saved);
    await commands.renameMeeting('meeting-1', '새 제목');

    expect(createSQLiteMeetingRepository).toHaveBeenCalledWith(database);
    expect(meetings.getByMeetingId).toHaveBeenCalledWith('meeting-1');
    expect(renameMeeting).toHaveBeenCalledWith(
      { repository: meetings, now: expect.any(Function) },
      { meetingId: 'meeting-1', title: '새 제목' },
    );
  });
});
