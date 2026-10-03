import { describe, expect, it } from 'vitest';

import type { TranscriptionPanelState } from '@/features/request-transcription';

import { toDetailMetaLabel } from './to-detail-meta-label';

describe('toDetailMetaLabel', () => {
  it.each<[TranscriptionPanelState, string]>([
    [{ kind: 'loading' }, '52분 14초'],
    [{ kind: 'none', notice: null }, '52분 14초 · 녹음만 저장됨'],
    [{ kind: 'none', notice: 'start-failed' }, '52분 14초 · 변환 시작 실패'],
    [{ kind: 'none', notice: 'recording-rejected' }, '52분 14초 · 변환 시작 실패'],
    [{ kind: 'rejected' }, '52분 14초 · 변환 불가'],
    [{ kind: 'sending', progress: 40 }, '52분 14초 · 변환 요청 중'],
    [{ kind: 'created', reason: 'send-failed' }, '52분 14초 · 변환 요청 미완료'],
    [{ kind: 'queued' }, '52분 14초 · 변환 대기'],
    [{ kind: 'processing' }, '52분 14초 · 텍스트 변환 중'],
    [{ kind: 'failed', errorCode: null }, '52분 14초 · 변환 실패'],
    [
      { kind: 'completed', content: { durationMs: 1, segments: [] } },
      '52분 14초 · 텍스트 변환 완료',
    ],
    [{ kind: 'unreadable', status: 'completed' }, '52분 14초 · 텍스트 변환 완료'],
    [{ kind: 'unreadable', status: null }, '52분 14초'],
  ])('%o → %s', (panel, label) => {
    expect(toDetailMetaLabel('52분 14초', panel)).toBe(label);
  });
});
