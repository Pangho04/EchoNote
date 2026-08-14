import type { RecordingPermissionService } from '../api/recording-permission-service';
import { RecordingPermission } from '../api/recording-permission-service';

export async function requestRecordingPermission(
  service: RecordingPermissionService,
): Promise<RecordingPermission> {
  const currentPermission = await service.get();

  switch (currentPermission) {
    case RecordingPermission.GRANTED:
    case RecordingPermission.BLOCKED:
      return currentPermission;

    case RecordingPermission.DENIED:
      return await service.request();
  }
}
