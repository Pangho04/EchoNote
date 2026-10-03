import type { TranscriptionPanelState } from '@/features/request-transcription';
import { UI_STRINGS } from '@/shared/config/ui-strings';

function toStatusLabel(panel: TranscriptionPanelState): string | null {
  switch (panel.kind) {
    case 'loading':
      return null;
    case 'none':
      return panel.notice === null
        ? UI_STRINGS.meetingStatus.localOnly.metaLabel
        : UI_STRINGS.transcription.noticeMetaLabel;
    case 'rejected':
      return UI_STRINGS.transcription.rejectedMetaLabel;
    case 'sending':
      return UI_STRINGS.transcription.sendingMetaLabel;
    case 'created':
    case 'queued':
    case 'processing':
    case 'failed':
    case 'completed':
      return UI_STRINGS.meetingStatus[panel.kind].metaLabel;
    case 'unreadable':
      return panel.status === null ? null : UI_STRINGS.meetingStatus[panel.status].metaLabel;
  }
}

// 상세 헤더 메타 줄. 녹음 길이 뒤에 텍스트 변환 상태를 붙이고, 상태를 모르면 길이만 둔다.
export function toDetailMetaLabel(durationLabel: string, panel: TranscriptionPanelState): string {
  const statusLabel = toStatusLabel(panel);

  return statusLabel === null ? durationLabel : `${durationLabel} · ${statusLabel}`;
}
