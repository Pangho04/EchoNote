import { CodedError } from '@/shared/lib/coded-error';

import type { Meeting } from './meeting';

// rename 대상 회의가 이미 지워졌거나 존재하지 않을 때 던진다.
export class MeetingNotFoundError extends CodedError {
  readonly code = 'MEETING_NOT_FOUND';
}

export type MeetingListCursor = {
  createdAtMs: number;
  meetingId: string;
};

/** 녹음 생성 시 SQLite에 전달하는 Params */
export type CreateMeetingParams = {
  meetingId: string;
  title: string;
  createdAt: string;
};

/** 제목 변경 시 SQLite에 전달하는 Params */
export type RenameMeetingParams = {
  meetingId: string;
  title: string;
  updatedAt: string;
};

/** 녹음 목록 조회 시 SQLite에 전달하는 Query */
export type ListMeetingsQuery = {
  yearStartMs: number;
  nextYearStartMs: number;
  limit: number;
  cursor?: MeetingListCursor; // 지정하면 이 cursor가 가리키는 Meeting부터 결과에 포함한다.
};

export type ListMeetingsResult = {
  meetings: Meeting[];
  nextCursor: MeetingListCursor | null; // 다음 page의 첫 Meeting을 가리킨다. 다음 page가 없으면 null이다.
};

export type MeetingRepository = {
  create: (params: CreateMeetingParams) => Promise<Meeting>;
  list: (query: ListMeetingsQuery) => Promise<ListMeetingsResult>;
  getByMeetingId: (meetingId: string) => Promise<Meeting | null>;
  // 영향 행 0건이면 MeetingNotFoundError를 던진다.
  rename: (params: RenameMeetingParams) => Promise<void>;
};
