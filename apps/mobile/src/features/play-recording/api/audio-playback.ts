export enum PlaybackStatusKind {
  LOADING,
  READY,
  PLAYING,
  ENDED,
  ERROR,
}

export interface AudioPlaybackStatus {
  kind: PlaybackStatusKind;
  positionMs: number;
  // native player가 길이를 아직 보고하지 않았으면 null이다.
  durationMs: number | null;
  errorMessage: string | null;
}

// 앱 쪽 시간 단위는 전부 millisecond다. seconds 변환은 native 구현 한곳만 한다.
export interface AudioPlayback {
  status: AudioPlaybackStatus;
  // status는 주기적으로만 갱신되므로 seek 계산은 이 값을 읽는다.
  getPositionMs(): number;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): Promise<void>;
}
