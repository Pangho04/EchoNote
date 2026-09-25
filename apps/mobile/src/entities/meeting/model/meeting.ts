export enum MeetingStatus {
  LocalOnly = 'local_only',
  Created = 'created',
  Queued = 'queued',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  createdAt: string; // EchoNote에 등록된 시각
  updatedAt: string; // 마지막으로 수정된 시각
  durationMs: number | null;
};

// 목록 오른쪽 끝 표시. chip과 상세 이동 표시는 배타적이다.
export type MeetingListAccessory = { kind: 'chip'; label: string } | { kind: 'arrow' };

export type MeetingListVMItem = {
  id: string;
  title: string;
  monthLabel: string;
  dayLabel: string;
  metaLabel: string;
  accessory: MeetingListAccessory;
};
