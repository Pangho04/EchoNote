import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createSleepPreventer } from './prevent-sleep.js';

const fakeChild = () => Object.assign(new EventEmitter(), { stdin: new PassThrough() });

describe('createSleepPreventer', () => {
  it('Windows가 아니면 PowerShell을 띄우지 않는다', () => {
    const spawnPowerShell = vi.fn();
    const preventSleep = createSleepPreventer({
      logger: { warn: vi.fn() },
      platform: 'darwin',
      spawnPowerShell,
    });

    preventSleep()();

    expect(spawnPowerShell).not.toHaveBeenCalled();
  });

  it('Windows에서는 창 없이 PowerShell을 띄우고 해제하면 stdin을 닫는다', () => {
    const child = fakeChild();
    const spawnPowerShell = vi.fn(() => child);
    const preventSleep = createSleepPreventer({
      logger: { warn: vi.fn() },
      platform: 'win32',
      spawnPowerShell: spawnPowerShell as never,
    });

    const release = preventSleep();

    expect(spawnPowerShell).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );

    const script = Buffer.from(
      (spawnPowerShell.mock.calls[0] as unknown as [string, string[]])[1][3]!,
      'base64',
    ).toString('utf16le');

    expect(script).toContain('SetThreadExecutionState([uint32]2147483649)');
    expect(child.stdin.writableEnded).toBe(false);

    release();

    expect(child.stdin.writableEnded).toBe(true);
  });

  it('PowerShell 실행 실패는 code만 경고하고 던지지 않는다', () => {
    const child = fakeChild();
    const logger = { warn: vi.fn() };
    const preventSleep = createSleepPreventer({
      logger,
      platform: 'win32',
      spawnPowerShell: (() => child) as never,
    });

    preventSleep();
    child.emit('error', Object.assign(new Error('spawn C:\\secret ENOENT'), { code: 'ENOENT' }));

    expect(logger.warn).toHaveBeenCalledWith({ code: 'ENOENT' }, 'prevent sleep failed');
  });
});
