export enum MeetingStatus {
  LocalOnly = 'local_only',
  WaitingForNode = 'waiting_for_node',
  AwaitingUpload = 'awaiting_upload',
  Uploading = 'uploading',
  Queued = 'queued',
  Transcribing = 'transcribing',
  Transcribed = 'transcribed',
  Reviewing = 'reviewing',
  Summarizing = 'summarizing',
  Completed = 'completed',
  AnalysisFailed = 'analysis_failed',
  AnalysisRetryQueued = 'analysis_retry_queued',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export type Meeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
};

export type MeetingListItemVM = {
  id: string;
  title: string;
  monthLabel: string;
  dayLabel: string;
  metaLabel: string;
  statusLabel: string;
};
