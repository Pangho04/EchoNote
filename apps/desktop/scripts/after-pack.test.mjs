import { readFileSync } from 'node:fs';
import path from 'node:path';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { Arch } from 'electron-builder';
import { beforeEach, expect, test, vi } from 'vitest';

import applyElectronFuses from './after-pack.mjs';

const desktopPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

vi.mock('@electron/fuses', async (importOriginal) => ({
  ...(await importOriginal()),
  flipFuses: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(flipFuses).mockClear();
});

test('macOS arm64 패키징 후 Electron 앱을 ad-hoc 재서명한다', async () => {
  const appOutDir = '/tmp/echonote-out';

  await applyElectronFuses({
    appOutDir,
    arch: Arch.arm64,
    electronPlatformName: 'darwin',
    packager: {
      appInfo: {
        productFilename: 'EchoNote',
      },
    },
  });

  expect(flipFuses).toHaveBeenCalledWith(
    path.join(appOutDir, 'EchoNote.app', 'Contents', 'MacOS', 'EchoNote'),
    {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: true,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
      [FuseV1Options.WasmTrapHandlers]: true,
    },
  );
});

test('개발용 앱 빌드에서는 인증서 자동 탐색을 비활성화한다', () => {
  expect(desktopPackage.scripts.build).toContain(
    'CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir',
  );
  expect(desktopPackage.scripts.make).not.toContain('CSC_IDENTITY_AUTO_DISCOVERY');
});
