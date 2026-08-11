import * as Crypto from 'expo-crypto';

import { type Meeting, type MeetingRepository, nomalizeMeetingTitle } from '@/entities/meeting';

type CreateMeetingDependencies = {
  repository: MeetingRepository;
};

export function makeCreateMeeting({ repository }: CreateMeetingDependencies) {
  return async function createMeeting(title: string): Promise<Meeting> {
    const requestedAt = new Date().toISOString();
    const params = {
      meetingId: Crypto.randomUUID(),
      title: nomalizeMeetingTitle(title, requestedAt),
      startedAt: requestedAt,
      requestedAt,
    };

    return repository.create(params);
  };
}
