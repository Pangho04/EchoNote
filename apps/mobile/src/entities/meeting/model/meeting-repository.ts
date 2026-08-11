import type { Meeting } from './meeting';

export type CreateMeetingParams = {
  meetingId: string;
  title: string;
  startedAt: string;
  requestedAt: string;
};

export type MeetingListCursor = {
  startedAtMs: number;
  meetingId: string;
};

export type ListMeetingsQuery = {
  yearStartMs: number;
  nextYearStartMs: number;
  limit: number;
  /** 지정하면 이 cursor가 가리키는 Meeting부터 결과에 포함한다. */
  cursor?: MeetingListCursor;
};

export type ListMeetingsResult = {
  meetings: Meeting[];
  /** 다음 page의 첫 Meeting을 가리킨다. 다음 page가 없으면 null이다. */
  nextCursor: MeetingListCursor | null;
};

export type MeetingRepository = {
  create: (params: CreateMeetingParams) => Promise<Meeting>;
  list: (query: ListMeetingsQuery) => Promise<ListMeetingsResult>;
};
