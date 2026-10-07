import type { TranscriptContent } from '@/entities/transcript';
import type { TranscriptionPanelState } from '@/features/request-transcription';

export function toExportTranscript(panel: TranscriptionPanelState): TranscriptContent | null {
  switch (panel.kind) {
    case 'completed':
      return panel.content;
    case 'loading':
    case 'none':
    case 'rejected':
    case 'sending':
    case 'created':
    case 'queued':
    case 'processing':
    case 'failed':
    case 'unreadable':
      return null;
  }
}
