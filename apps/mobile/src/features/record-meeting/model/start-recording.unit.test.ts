import { describe, expect, it, vi } from 'vitest';

import { RecordingPermission, type RecordingPermissionService } from '../api/recording-permission';
import { clearRecordingDraft, getRecordingDraft } from './recording-draft';
import { startRecording } from './start-recording';

function makeService(
  overrides: Partial<RecordingPermissionService> = {},
): RecordingPermissionService {
  return {
    get: vi.fn(async () => RecordingPermission.GRANTED),
    request: vi.fn(async () => RecordingPermission.GRANTED),
    openSettings: vi.fn(async () => undefined),
    requestBackgroundRecording: vi.fn(async () => undefined),
    ...overrides,
  };
}

const meetingIdFactory = () => 'm1';

describe('startRecording', () => {
  it('granted면 meetingId를 만들고 draft에 담는다', async () => {
    clearRecordingDraft('m1');

    const result = await startRecording(
      makeService({ get: vi.fn(async () => RecordingPermission.GRANTED) }),
      '제목',
      meetingIdFactory,
    );

    expect(result).toEqual({ kind: 'granted', meetingId: 'm1' });
    expect(getRecordingDraft('m1')).toEqual({ meetingId: 'm1', titleInput: '제목' });
  });

  it('granted면 request를 호출하지 않는다', async () => {
    const request = vi.fn();

    await startRecording(
      makeService({ get: vi.fn(async () => RecordingPermission.GRANTED), request }),
      '제목',
      meetingIdFactory,
    );

    expect(request).not.toHaveBeenCalled();
  });

  it('denied면 request를 호출한 뒤 denied를 반환한다', async () => {
    const request = vi.fn(async () => RecordingPermission.DENIED);

    const result = await startRecording(
      makeService({ get: vi.fn(async () => RecordingPermission.DENIED), request }),
      '제목',
      meetingIdFactory,
    );

    expect(request).toHaveBeenCalled();
    expect(result).toEqual({ kind: 'denied' });
  });

  it('granted일 때만 백그라운드 녹음 권한을 묻는다', async () => {
    const granted = makeService();
    const denied = makeService({
      get: vi.fn(async () => RecordingPermission.DENIED),
      request: vi.fn(async () => RecordingPermission.DENIED),
    });

    await startRecording(granted, '제목', meetingIdFactory);
    await startRecording(denied, '제목', meetingIdFactory);

    expect(granted.requestBackgroundRecording).toHaveBeenCalledTimes(1);
    expect(denied.requestBackgroundRecording).not.toHaveBeenCalled();
  });

  it('blocked면 blocked를 반환한다', async () => {
    const result = await startRecording(
      makeService({ get: vi.fn(async () => RecordingPermission.BLOCKED) }),
      '제목',
      meetingIdFactory,
    );

    expect(result).toEqual({ kind: 'blocked' });
  });
});
