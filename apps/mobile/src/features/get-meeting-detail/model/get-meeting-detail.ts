import type { Meeting, MeetingRepository } from '@/entities/meeting';
import type { Recording, RecordingRepository } from '@/entities/recording';
import { normalizeError } from '@/shared/lib/coded-error';

// not-found는 "그 meetingId의 Meeting이 없다"만 뜻한다.
// Meeting은 있는데 saved Recording이 없으면 Meeting 1:1 Recording 불변식 위반이므로 error다.
// recording-missing은 DB 행은 있는데 그 경로에 녹음 파일이 없다는 뜻이다.
export type MeetingDetailResult =
  | { kind: 'ready'; meeting: Meeting; recording: Recording }
  | { kind: 'not-found' }
  | { kind: 'recording-missing' }
  | { kind: 'error'; message: string };

export type GetMeetingDetailDependencies = {
  meetings: Pick<MeetingRepository, 'getByMeetingId'>;
  recordings: Pick<RecordingRepository, 'getSavedByMeetingId'>;
  recordingFileExists: (uri: string) => boolean;
};

export async function getMeetingDetail(
  deps: GetMeetingDetailDependencies,
  meetingId: string,
): Promise<MeetingDetailResult> {
  try {
    const meeting = await deps.meetings.getByMeetingId(meetingId);

    // Meeting이 없으면 Recording을 조회하지 않는다.
    if (!meeting) return { kind: 'not-found' };

    const recording = await deps.recordings.getSavedByMeetingId(meetingId);

    if (!recording) {
      return { kind: 'error', message: `회의 ${meetingId}에 저장된 녹음이 없습니다.` };
    }

    if (!deps.recordingFileExists(recording.uri)) return { kind: 'recording-missing' };

    return { kind: 'ready', meeting, recording };
  } catch (error) {
    return { kind: 'error', message: normalizeError(error).message };
  }
}
