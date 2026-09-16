import { describe, expectTypeOf, it } from 'vitest';

import type { Meeting } from './meeting';
import type {
  ListMeetingsQuery,
  ListMeetingsResult,
  MeetingListCursor,
  MeetingRepository,
} from './meeting-repository';

describe('MeetingRepository type contract', () => {
  it('목록 기능이 만든 조회 조건만 list 입력으로 받는다', () => {
    expectTypeOf<Parameters<MeetingRepository['list']>[0]>().toEqualTypeOf<ListMeetingsQuery>();
    expectTypeOf<ListMeetingsQuery>().toEqualTypeOf<{
      yearStartMs: number;
      nextYearStartMs: number;
      limit: number;
      cursor?: MeetingListCursor;
    }>();
  });

  it('cursor와 목록 결과의 페이지 계약을 고정한다', () => {
    expectTypeOf<MeetingListCursor>().toEqualTypeOf<{
      createdAtMs: number;
      meetingId: string;
    }>();
    expectTypeOf<ListMeetingsResult>().toEqualTypeOf<{
      meetings: Meeting[];
      nextCursor: MeetingListCursor | null;
    }>();
  });

  it('1A repository가 저장·범위 목록 조회·단건 조회만 공개한다', () => {
    expectTypeOf<keyof MeetingRepository>().toEqualTypeOf<'create' | 'list' | 'getByMeetingId'>();
  });
});
