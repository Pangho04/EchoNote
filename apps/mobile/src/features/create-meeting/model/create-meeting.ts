import * as Crypto from 'expo-crypto';

import { type Meeting, type MeetingRepository, nomalizeMeetingTitle } from '@/entities/meeting';

type CreateMeetingDependencies = {
  repository: MeetingRepository;
};

export function makeCreateMeeting({ repository }: CreateMeetingDependencies) {
  return async function createMeeting(title: string): Promise<Meeting> {
    const createdAt = new Date().toISOString();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!timeZone) {
      throw new Error('기기 현재 time zone을 확인할 수 없습니다.');
    }

    const params = {
      meetingId: Crypto.randomUUID(),
      title: nomalizeMeetingTitle(title, createdAt, timeZone),
      createdAt,
    };

    return repository.create(params);
  };
}
