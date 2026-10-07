import { describe, expect, it } from 'vitest';

import type { TranscriptionPanelState } from '@/features/request-transcription';

import { toExportTranscript } from './to-export-transcript';

const content = { durationMs: 1_000, segments: [{ startMs: 0, endMs: 1_000, text: '안녕' }] };

describe('toExportTranscript', () => {
  it('completed면 전사 내용을 돌려준다', () => {
    expect(toExportTranscript({ kind: 'completed', content })).toBe(content);
  });

  it.each<TranscriptionPanelState>([
    { kind: 'loading' },
    { kind: 'none', notice: null },
    { kind: 'rejected' },
    { kind: 'sending', progress: null },
    { kind: 'created', reason: 'interrupted' },
    { kind: 'queued' },
    { kind: 'processing' },
    { kind: 'failed', errorCode: null },
    { kind: 'unreadable', status: null },
  ])('$kind이면 null이다', (panel) => {
    expect(toExportTranscript(panel)).toBeNull();
  });
});
