import type { PermissionResponse } from 'expo-audio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingPermission } from './recording-permission-service';
import {
  mapRecordingPermission,
  recordingPermissionService,
} from './recording-permission-service.native';

const mocks = vi.hoisted(() => ({
  getPermission: vi.fn<() => Promise<PermissionResponse>>(),
  requestPermission: vi.fn<() => Promise<PermissionResponse>>(),
  openSettings: vi.fn<() => Promise<void>>(),
}));

vi.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: mocks.getPermission,
  requestRecordingPermissionsAsync: mocks.requestPermission,
}));

vi.mock('react-native', () => ({
  Linking: { openSettings: mocks.openSettings },
}));

const grantedResponse: PermissionResponse = {
  status: 'granted' as PermissionResponse['status'],
  expires: 'never',
  granted: true,
  canAskAgain: true,
};

const deniedResponse: PermissionResponse = {
  status: 'denied' as PermissionResponse['status'],
  expires: 'never',
  granted: false,
  canAskAgain: true,
};

const blockedResponse: PermissionResponse = {
  status: 'denied' as PermissionResponse['status'],
  expires: 'never',
  granted: false,
  canAskAgain: false,
};

describe('mapRecordingPermission', () => {
  it.each([
    [grantedResponse, RecordingPermission.GRANTED],
    [deniedResponse, RecordingPermission.DENIED],
    [blockedResponse, RecordingPermission.BLOCKED],
  ] as const)('Expo 응답 %#을 앱 권한 상태로 바꾼다', (response, expected) => {
    expect(mapRecordingPermission(response)).toBe(expected);
  });
});

describe('recordingPermissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('현재 Expo 권한을 한 번 조회하고 앱 권한 상태로 반환한다', async () => {
    mocks.getPermission.mockResolvedValueOnce(grantedResponse);

    const result = await recordingPermissionService.get();

    expect(result).toBe(RecordingPermission.GRANTED);
    expect(mocks.getPermission).toHaveBeenCalledTimes(1);
  });

  it('Expo 권한을 한 번 요청하고 앱 권한 상태로 반환한다', async () => {
    mocks.requestPermission.mockResolvedValueOnce(blockedResponse);

    const result = await recordingPermissionService.request();

    expect(result).toBe(RecordingPermission.BLOCKED);
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('OS 앱 설정 화면을 한 번 연다', async () => {
    mocks.openSettings.mockResolvedValueOnce(undefined);

    await recordingPermissionService.openSettings();

    expect(mocks.openSettings).toHaveBeenCalledTimes(1);
  });
});
