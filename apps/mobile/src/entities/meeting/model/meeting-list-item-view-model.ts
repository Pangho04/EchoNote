import { type Meeting, type MeetingListItemVM, MeetingStatus } from './meeting';

/**
 * Utils
 */

// ------------ Date -------------------
export type MeetingDateLabels = Pick<MeetingListItemVM, 'monthLabel' | 'dayLabel'>;

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value;
}

export function extractMeetingDateLabels(startedAt: string, timeZone: string): MeetingDateLabels {
  const meetingDateFormatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
  });
  const parts = meetingDateFormatter.formatToParts(new Date(startedAt));
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');

  if (!month || !day) {
    throw new RangeError(`회의 날짜 label을 만들 수 없습니다: ${startedAt}`);
  }

  return {
    monthLabel: `${month}월`,
    dayLabel: day.padStart(2, '0'),
  };
}

// ------------ Meta -------------------
export function formatMeetingDurationLabel(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;

  return `${hours}시간 ${minutes}분`;
}

type MeetingStatusLabels = {
  metaLabel: string;
  statusLabel: string;
};

const MEETING_STATUS_LABELS: Record<MeetingStatus, MeetingStatusLabels> = {
  [MeetingStatus.LocalOnly]: {
    metaLabel: '녹음만 저장됨',
    statusLabel: '로컬',
  },
  [MeetingStatus.WaitingForNode]: {
    metaLabel: '데스크탑 대기 중',
    statusLabel: '대기',
  },
  [MeetingStatus.AwaitingUpload]: {
    metaLabel: '업로드 대기',
    statusLabel: '대기',
  },
  [MeetingStatus.Uploading]: {
    metaLabel: '업로드 중',
    statusLabel: '업로드 중',
  },
  [MeetingStatus.Queued]: {
    metaLabel: '전사 대기',
    statusLabel: '대기',
  },
  [MeetingStatus.Transcribing]: {
    metaLabel: '전사 중',
    statusLabel: '전사 중',
  },
  [MeetingStatus.Transcribed]: {
    metaLabel: '전사 완료',
    statusLabel: '전사 완료',
  },
  [MeetingStatus.Reviewing]: {
    metaLabel: '오전사 검토 필요',
    statusLabel: '검토 필요',
  },
  [MeetingStatus.Summarizing]: {
    metaLabel: '요약 중',
    statusLabel: '요약 중',
  },
  [MeetingStatus.Completed]: {
    metaLabel: '전사와 요약 완료',
    statusLabel: '완료',
  },
  [MeetingStatus.AnalysisFailed]: {
    metaLabel: '분석 실패',
    statusLabel: '분석 실패',
  },
  [MeetingStatus.AnalysisRetryQueued]: {
    metaLabel: '분석 재시도 대기',
    statusLabel: '재시도 대기',
  },
  [MeetingStatus.Failed]: {
    metaLabel: '처리 실패',
    statusLabel: '실패',
  },
  [MeetingStatus.Cancelled]: {
    metaLabel: '처리 취소됨',
    statusLabel: '취소됨',
  },
};

export function toMeetingListItemVM(meeting: Meeting, timeZone: string): MeetingListItemVM {
  const dateLabels = extractMeetingDateLabels(meeting.startedAt, timeZone);
  const statusLabels = MEETING_STATUS_LABELS[meeting.status];
  const durationLabel =
    meeting.durationMs === null ? null : formatMeetingDurationLabel(meeting.durationMs);
  const statusMetaLabel =
    meeting.status === MeetingStatus.LocalOnly && meeting.durationMs === null
      ? '녹음 대기'
      : statusLabels.metaLabel;

  return {
    id: meeting.id,
    title: meeting.title,
    monthLabel: dateLabels.monthLabel,
    dayLabel: dateLabels.dayLabel,
    metaLabel: durationLabel ? `${durationLabel} · ${statusMetaLabel}` : statusMetaLabel,
    statusLabel: statusLabels.statusLabel,
  };
}
