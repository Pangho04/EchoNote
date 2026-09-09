import type { PermissionResponse } from 'expo-audio';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';

import type { RecordingPermissionService } from './recording-permission';
import { RecordingPermission } from './recording-permission';

export function mapRecordingPermission(response: PermissionResponse): RecordingPermission {
  if (response.granted === true) return RecordingPermission.GRANTED;

  if (response.canAskAgain === true) return RecordingPermission.DENIED;

  return RecordingPermission.BLOCKED;
}

export const recordingPermissionService: RecordingPermissionService = {
  get: async () => {
    const response = await getRecordingPermissionsAsync();

    return mapRecordingPermission(response);
  },
  request: async () => {
    const response = await requestRecordingPermissionsAsync();

    return mapRecordingPermission(response);
  },
  openSettings: async () => {
    await Linking.openSettings();
    return;
  },
};
