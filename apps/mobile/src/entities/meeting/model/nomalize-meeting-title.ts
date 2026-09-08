function formatDefaultMeetingTitle(createdAt: string, timeZone: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`등록 시각이 올바른 ISO 문자열이 아닙니다: ${createdAt}`);
  }

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h12',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  ) as Record<string, string>;

  const dayPeriod = parts.dayPeriod ?? '';
  const separator = dayPeriod ? ' ' : '';

  return `${parts.year}-${parts.month}-${parts.day} ${dayPeriod}${separator}${parts.hour}:${parts.minute}:${parts.second}_녹음`;
}

/**
 * @param origin 원본 타이틀
 * @param createdAt EchoNote 등록 시각
 * @param timeZone Meeting 생성 당시 기기 IANA time zone
 * @description 원본 타이틀을 도메인 규칙에 적합하게 수정합니다.
 */
export function nomalizeMeetingTitle(origin: string, createdAt: string, timeZone: string): string {
  const title = origin.trim().replace(/\s+/g, ' ').slice(0, 80);

  if (title) return title;

  return formatDefaultMeetingTitle(createdAt, timeZone);
}
