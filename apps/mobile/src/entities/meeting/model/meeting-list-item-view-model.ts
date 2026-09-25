import { UI_STRINGS } from '@/shared/config/ui-strings';

import { type Meeting, type MeetingListVMItem, MeetingStatus } from './meeting';

/**
 * Utils
 */

// ------------ Date -------------------
export type MeetingDateLabels = Pick<MeetingListVMItem, 'monthLabel' | 'dayLabel'>;

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value;
}

export function extractMeetingDateLabels(createdAt: string, timeZone: string): MeetingDateLabels {
  const meetingDateFormatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
  });
  const parts = meetingDateFormatter.formatToParts(new Date(createdAt));
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');

  if (!month || !day) {
    throw new RangeError(`회의 날짜 label을 만들 수 없습니다: ${createdAt}`);
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
  // LocalOnly는 chip 대신 화살표를 그려 이 label은 렌더되지 않는다. 표를 전수로 유지하려고 남긴다.
  [MeetingStatus.LocalOnly]: UI_STRINGS.meetingStatus.localOnly,
  [MeetingStatus.Created]: UI_STRINGS.meetingStatus.created,
  [MeetingStatus.Queued]: UI_STRINGS.meetingStatus.queued,
  [MeetingStatus.Processing]: UI_STRINGS.meetingStatus.processing,
  [MeetingStatus.Completed]: UI_STRINGS.meetingStatus.completed,
  [MeetingStatus.Failed]: UI_STRINGS.meetingStatus.failed,
};

/** Domain Date -> VM Mapper */
export function toMeetingListItemVM(meeting: Meeting, timeZone: string): MeetingListVMItem {
  const dateLabels = extractMeetingDateLabels(meeting.createdAt, timeZone);
  const statusLabels = MEETING_STATUS_LABELS[meeting.status];
  const durationLabel =
    meeting.durationMs === null ? null : formatMeetingDurationLabel(meeting.durationMs);
  const statusMetaLabel =
    meeting.status === MeetingStatus.LocalOnly && meeting.durationMs === null
      ? UI_STRINGS.meetingStatus.recordingPending
      : statusLabels.metaLabel;

  return {
    id: meeting.id,
    title: meeting.title,
    monthLabel: dateLabels.monthLabel,
    dayLabel: dateLabels.dayLabel,
    metaLabel: durationLabel ? `${durationLabel} · ${statusMetaLabel}` : statusMetaLabel,
    // local-only는 chip 없이 상세 이동 표시만 둔다.
    accessory:
      meeting.status === MeetingStatus.LocalOnly
        ? { kind: 'arrow' }
        : { kind: 'chip', label: statusLabels.statusLabel },
  };
}
