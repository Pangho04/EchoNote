import type { RecordingPermissionService } from '../api/recording-permission';
import { RecordingPermission } from '../api/recording-permission';
import { setRecordingDraft } from './recording-draft';

export type StartRecordingResult =
  { kind: 'granted'; meetingId: string } | { kind: 'denied' } | { kind: 'blocked' };

export type RecordingIdFactory = () => string;

// 녹음 시작: 권한 확인 → GRANTED면 meetingId를 만들고 draft에 담는다. DB에는 쓰지 않는다.
// meetingId 생성은 바깥의 주입 factory가 담당한다(native crypto 분리).
export async function startRecording(
  permissionService: RecordingPermissionService,
  titleInput: string,
  meetingIdFactory: RecordingIdFactory,
): Promise<StartRecordingResult> {
  const permission = await requestPermission(permissionService);

  if (permission === RecordingPermission.GRANTED) {
    const meetingId = meetingIdFactory();

    setRecordingDraft({ meetingId, titleInput });

    return { kind: 'granted', meetingId };
  }

  if (permission === RecordingPermission.DENIED) {
    return { kind: 'denied' };
  }

  return { kind: 'blocked' };
}

async function requestPermission(
  service: RecordingPermissionService,
): Promise<RecordingPermission> {
  const current = await service.get();

  if (current === RecordingPermission.GRANTED || current === RecordingPermission.BLOCKED) {
    return current;
  }

  return await service.request();
}
