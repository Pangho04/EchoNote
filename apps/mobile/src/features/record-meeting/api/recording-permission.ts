export enum RecordingPermission {
  GRANTED,
  DENIED,
  BLOCKED,
}

export interface RecordingPermissionService {
  get(): Promise<RecordingPermission>;
  request(): Promise<RecordingPermission>;
  openSettings(): Promise<void>;
  // Android는 백그라운드 녹음 알림 권한을 묻는다. 거절해도 녹음은 앱이 화면에 있는 동안 진행된다.
  requestBackgroundRecording(): Promise<void>;
}
