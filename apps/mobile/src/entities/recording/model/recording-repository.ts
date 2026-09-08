import type { Recording } from './recording';

/** stored Recording read 전용 계약이다. 쓰기 전용 MeetingRecordingPersistence와 분리한다. */
export type RecordingRepository = {
  getSavedByMeetingId(meetingId: string): Promise<Recording | null>;
};
