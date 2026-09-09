import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { createSQLiteMeetingRepository } from '@/entities/meeting';
import { createSQLiteRecordingRepository } from '@/entities/recording';
import { getMeetingDetail } from '@/features/get-meeting-detail';

import { createMeetingDetailLoader } from './create-meeting-detail-loader';

vi.mock('@/entities/meeting', () => ({ createSQLiteMeetingRepository: vi.fn() }));
vi.mock('@/entities/recording', () => ({ createSQLiteRecordingRepository: vi.fn() }));
vi.mock('@/features/get-meeting-detail', () => ({ getMeetingDetail: vi.fn() }));

describe('createMeetingDetailLoader', () => {
  it('두 SQLite repository를 같은 database로 만들어 use case에 주입한다', async () => {
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
    expect(getMeetingDetail).toHaveBeenCalledWith({ meetings, recordings }, 'meeting-1');
    expect(result).toEqual({ kind: 'not-found' });
  });
});
