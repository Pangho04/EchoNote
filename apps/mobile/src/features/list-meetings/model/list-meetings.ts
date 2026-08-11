import type { ListMeetingsResult, MeetingListCursor, MeetingRepository } from '@/entities/meeting';

export type ListMeetingsParams = {
  year: number;
  limit: number;
  cursor?: MeetingListCursor;
};

export type ListMeetingsUseCaseResult = ListMeetingsResult & {
  // 이 조회의 UTC 범위 계산에 실제 사용한 기기 time zone이다.
  timeZone: string;
};

export function getCurrentTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!timeZone) {
    throw new Error('기기 현재 time zone을 확인할 수 없습니다.');
  }

  return timeZone;
}

function getTimeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
  const displayedAsUtcMs = Date.UTC(
    values.year as number,
    (values.month as number) - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return displayedAsUtcMs - Math.trunc(instantMs / 1_000) * 1_000;
}

function getYearStartMs(year: number, timeZone: string): number {
  const localMidnightAsUtcMs = Date.UTC(year, 0, 1);
  let instantMs = localMidnightAsUtcMs;

  // DST나 UTC offset 때문에 달라지는 값을 수렴할 때까지 보정한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const adjustedMs = localMidnightAsUtcMs - getTimeZoneOffsetMs(instantMs, timeZone);

    if (adjustedMs === instantMs) return instantMs;

    instantMs = adjustedMs;
  }

  return instantMs;
}

export function getMeetingYearRangeMs(year: number, timeZone: string) {
  return {
    yearStartMs: getYearStartMs(year, timeZone),
    nextYearStartMs: getYearStartMs(year + 1, timeZone),
  };
}

export function makeListMeetings(repository: MeetingRepository) {
  return async function listMeetings(
    params: ListMeetingsParams,
  ): Promise<ListMeetingsUseCaseResult> {
    const timeZone = getCurrentTimeZone();
    const range = getMeetingYearRangeMs(params.year, timeZone);
    const result = await repository.list({
      ...range,
      limit: params.limit,
      cursor: params.cursor,
    });

    return { ...result, timeZone };
  };
}
