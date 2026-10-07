// 1시간 미만은 m:ss, 이상은 h:mm:ss다.
export function formatStartLabel(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;

  return `${minutes}:${seconds}`;
}
