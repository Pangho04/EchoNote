import { describe, expect, it, vi } from 'vitest';

import type { RecordingPermissionService } from '../api/recording-permission-service';
import { RecordingPermission } from '../api/recording-permission-service';
import { requestRecordingPermission } from './request-recording-permission';

type PermissionCase = {
  current: RecordingPermission;
  requested: RecordingPermission;
  expected: RecordingPermission;
  expectedRequestCount: number;
};

const cases: PermissionCase[] = [
  {
    current: RecordingPermission.GRANTED,
    requested: RecordingPermission.DENIED,
    expected: RecordingPermission.GRANTED,
    expectedRequestCount: 0,
  },
  {
    current: RecordingPermission.BLOCKED,
    requested: RecordingPermission.GRANTED,
    expected: RecordingPermission.BLOCKED,
    expectedRequestCount: 0,
  },
  {
    current: RecordingPermission.DENIED,
    requested: RecordingPermission.GRANTED,
    expected: RecordingPermission.GRANTED,
    expectedRequestCount: 1,
  },
  {
    current: RecordingPermission.DENIED,
    requested: RecordingPermission.DENIED,
    expected: RecordingPermission.DENIED,
    expectedRequestCount: 1,
  },
  {
    current: RecordingPermission.DENIED,
    requested: RecordingPermission.BLOCKED,
    expected: RecordingPermission.BLOCKED,
    expectedRequestCount: 1,
  },
];

describe('requestRecordingPermission', () => {
  it.each(cases)(
    '현재 권한 $current에서 필요한 경우에만 OS 권한을 요청한다',
    async ({ current, requested, expected, expectedRequestCount }) => {
      const get = vi.fn(async () => current);
      const request = vi.fn(async () => requested);
      const openSettings = vi.fn(async () => undefined);
      const service: RecordingPermissionService = {
        get,
        request,
        openSettings,
      };

      const result = await requestRecordingPermission(service);

      expect(result).toBe(expected);
      expect(get).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(expectedRequestCount);
      expect(openSettings).not.toHaveBeenCalled();
    },
  );
});
