import type { PermissionResponse } from 'expo-audio';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

import type { RecordingPermissionService } from './recording-permission';
import { RecordingPermission } from './recording-permission';

export function mapRecordingPermission(response: PermissionResponse): RecordingPermission {
  if (response.granted === true) return RecordingPermission.GRANTED;

  if (response.canAskAgain === true) return RecordingPermission.DENIED;

  return RecordingPermission.BLOCKED;
}

// Android 13부터 foreground service 알림 권한이 있어야 백그라운드 녹음을 켤 수 있다. 없는데 켜면 녹음 준비가 실패한다.
function needsNotificationPermission(): boolean {
  return Platform.OS === 'android' && Platform.Version >= 33;
}

export async function canRecordInBackground(): Promise<boolean> {
  if (!needsNotificationPermission()) return true;

  return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
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
  requestBackgroundRecording: async () => {
    if (!needsNotificationPermission()) return;

    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  },
};
