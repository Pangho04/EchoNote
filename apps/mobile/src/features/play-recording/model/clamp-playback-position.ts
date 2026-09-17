export interface ClampPlaybackPositionInput {
  positionMs: number;
  deltaMs: number;
  durationMs: number;
}

// 현재 위치에 delta를 더한 값을 0..durationMs 안으로 자른다.
export function clampPlaybackPosition(input: ClampPlaybackPositionInput): number {
  const { positionMs, deltaMs, durationMs } = input;

  if (!Number.isFinite(positionMs) || !Number.isFinite(deltaMs) || !Number.isFinite(durationMs)) {
    throw new RangeError(`재생 위치 계산 입력이 유한한 수가 아닙니다: ${JSON.stringify(input)}`);
  }

  if (durationMs < 0) {
    throw new RangeError(`녹음 길이가 음수입니다: ${durationMs}`);
  }

  return Math.min(durationMs, Math.max(0, positionMs + deltaMs));
}
