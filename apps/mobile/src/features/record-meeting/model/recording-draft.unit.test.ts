import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearRecordingDraft,
  getRecordingDraft,
  setRecordingDraft,
  updateRecordingDraftTitle,
} from './recording-draft';

describe('recordingDraft', () => {
  beforeEach(() => {
    clearRecordingDraft('*');
  });

  it('set 후 같은 meetingId로 조회한다', () => {
    setRecordingDraft({ meetingId: 'm1', titleInput: '제목' });

    expect(getRecordingDraft('m1')).toEqual({ meetingId: 'm1', titleInput: '제목' });
  });

  it('다른 meetingId 조회는 null이다', () => {
    setRecordingDraft({ meetingId: 'm1', titleInput: '제목' });

    expect(getRecordingDraft('m2')).toBeNull();
  });

  it('clear 후 다시 조회하면 null이다', () => {
    setRecordingDraft({ meetingId: 'm1', titleInput: '제목' });

    clearRecordingDraft('m1');

    expect(getRecordingDraft('m1')).toBeNull();
  });

  it('제목만 갱신해도 meetingId는 유지한다', () => {
    setRecordingDraft({ meetingId: 'm1', titleInput: '첫 제목' });

    updateRecordingDraftTitle('m1', '둘째 제목');

    expect(getRecordingDraft('m1')).toEqual({ meetingId: 'm1', titleInput: '둘째 제목' });
  });
});
