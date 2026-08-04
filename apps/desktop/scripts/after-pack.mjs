import path from 'node:path';

import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

export default async function applyElectronFuses(context) {
  const executableName = context.packager.appInfo.productFilename;
  const executablePath =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${executableName}.app`, 'Contents', 'MacOS', executableName)
      : path.join(
          context.appOutDir,
          context.electronPlatformName === 'win32' ? `${executableName}.exe` : executableName,
        );

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
}
