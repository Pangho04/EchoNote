export type TranscriptionErrorCode =
  | 'audio_missing'
  | 'stt_unavailable'
  | 'stt_failed'
  | 'result_rejected'
  | 'attempts_exhausted'
  | 'unexpected';

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptContent = {
  durationMs: number;
  segments: TranscriptSegment[];
};

// 앱 SQLite에 남은 마지막 텍스트 변환 시도. 진행 중 상태의 원본은 서버다.
export type Transcription =
  | { status: 'created' | 'queued' | 'processing'; jobId: string }
  | { status: 'failed'; jobId: string; errorCode: TranscriptionErrorCode | null }
  | { status: 'completed'; jobId: string; content: TranscriptContent };

export type TranscriptionStatus = Transcription['status'];

// 손상 행은 검증하지 못한 원문 status·job_id만 넘긴다.
export type StoredTranscription =
  | { kind: 'none' }
  | { kind: 'row'; transcription: Transcription }
  | { kind: 'corrupt'; status: string; jobId: string };

// 쓰기 함수는 바뀐 행이 있으면 true다. false면 다른 화면이 행을 먼저 바꾼 것이다.
export type TranscriptionRepository = {
  get(meetingId: string): Promise<StoredTranscription>;
  upsertCreated(meetingId: string, jobId: string): Promise<boolean>;
  updateStatus(
    meetingId: string,
    jobId: string,
    status: Exclude<TranscriptionStatus, 'completed'>,
    errorCode: TranscriptionErrorCode | null,
  ): Promise<boolean>;
  saveCompleted(meetingId: string, jobId: string, content: TranscriptContent): Promise<boolean>;
  delete(meetingId: string, jobId: string): Promise<boolean>;
  deleteCorrupt(meetingId: string, jobId: string): Promise<boolean>;
};
