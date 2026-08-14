export enum RecordingPermission {
  GRANTED,
  DENIED,
  BLOCKED,
}

export interface RecordingPermissionService {
  get(): Promise<RecordingPermission>;
  request(): Promise<RecordingPermission>;
  openSettings(): Promise<void>;
}
