const defaultMeetingTitleDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * @param origin 원본 타이틀
 * @param startedAt 회의 시작 시각
 * @description 원본 타이틀을 도메인 규칙에 적합하게 수정합니다.
 */
export function nomalizeMeetingTitle(origin: string, startedAt: string): string {
  const title = origin.trim();

  if (title) return title.slice(0, 80);

  return `${defaultMeetingTitleDateFormatter.format(new Date(startedAt))}_녹음`;
}
