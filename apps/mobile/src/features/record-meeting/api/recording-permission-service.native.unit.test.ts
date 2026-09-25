import type { PermissionResponse } from 'expo-audio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingPermission } from './recording-permission';
import {
  canRecordInBackground,
  mapRecordingPermission,
  recordingPermissionService,
} from './recording-permission-service.native';

const mocks = vi.hoisted(() => ({
  getPermission: vi.fn<() => Promise<PermissionResponse>>(),
  requestPermission: vi.fn<() => Promise<PermissionResponse>>(),
  openSettings: vi.fn<() => Promise<void>>(),
  checkAndroidPermission: vi.fn<() => Promise<boolean>>(),
  requestAndroidPermission: vi.fn<() => Promise<string>>(),
  platform: { OS: 'android', Version: 34 } as { OS: string; Version: number | string },
}));

vi.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: mocks.getPermission,
  requestRecordingPermissionsAsync: mocks.requestPermission,
}));

vi.mock('react-native', () => ({
  Linking: { openSettings: mocks.openSettings },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    check: mocks.checkAndroidPermission,
    request: mocks.requestAndroidPermission,
  },
  Platform: mocks.platform,
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

describe('백그라운드 녹음 알림 권한', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['android', 34, false, false, 1],
    ['android', 34, true, true, 1],
    ['android', 32, false, true, 0],
    ['ios', '18.0', false, true, 0],
  ] as const)(
    '%s %s에서 알림 권한 %s이면 백그라운드 녹음 가능 여부는 %s다',
    async (os, version, notificationGranted, expected, checkCount) => {
      Object.assign(mocks.platform, { OS: os, Version: version });
      mocks.checkAndroidPermission.mockResolvedValueOnce(notificationGranted);

      await expect(canRecordInBackground()).resolves.toBe(expected);
      expect(mocks.checkAndroidPermission).toHaveBeenCalledTimes(checkCount);
    },
  );

  it('Android 13 이상에서만 알림 권한을 요청한다', async () => {
    Object.assign(mocks.platform, { OS: 'android', Version: 34 });
    await recordingPermissionService.requestBackgroundRecording();

    Object.assign(mocks.platform, { OS: 'ios', Version: '18.0' });
    await recordingPermissionService.requestBackgroundRecording();

    expect(mocks.requestAndroidPermission).toHaveBeenCalledTimes(1);
    expect(mocks.requestAndroidPermission).toHaveBeenCalledWith(
      'android.permission.POST_NOTIFICATIONS',
    );
  });
});
