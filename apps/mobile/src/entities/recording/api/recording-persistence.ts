import type { Recording } from '../model/recording';

// Meeting 삽입은 entities/meeting의 CreateMeetingParams를 그대로 재사용하지 않는다.
// 같은 계층의 다른 slice를 직접 import하지 않는 FSD 규칙을 지키기 위해 인라인으로 둔다.
export type SaveMeetingWithRecordingParams = {
  meeting: {
    meetingId: string;
    title: string;
    createdAt: string;
  };
  recording: Recording;
};

// Meeting과 Recording을 하나의 transaction으로 함께 저장한다.
// 어떤 실패에서도 partial write가 남지 않는다.
export interface MeetingRecordingPersistence {
  saveMeetingWithRecording(params: SaveMeetingWithRecordingParams): Promise<void>;
  // 지운 Recording의 파일 URI를 돌려준다. 없는 meetingId는 건너뛴다.
  deleteMeetingsWithRecordings(meetingIds: string[]): Promise<string[]>;
}
