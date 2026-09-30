import { spawn } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';

import { codeOf } from '../stt/docker-transcriber.js';

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED(0x80000001). 화면은 꺼져도 되고 절전만 막는다.
// 이 요청은 호출한 프로세스가 살아 있는 동안만 유지된다. stdin이 닫히면 PowerShell이 끝나며 풀린다.
const SCRIPT = [
  '$power = Add-Type -Name Power -Namespace EchoNote -PassThru -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);\'',
  '[void]$power::SetThreadExecutionState([uint32]2147483649)',
  '[void][Console]::In.ReadToEnd()',
].join('\n');

// -EncodedCommand는 UTF-16LE base64를 받는다. 따옴표 escape 문제를 피한다.
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

type SleepPreventerOptions = {
  logger: Pick<FastifyBaseLogger, 'warn'>;
  platform?: NodeJS.Platform;
  spawnPowerShell?: typeof spawn;
};

// Windows에서만 동작한다. 호출할 때마다 PowerShell 하나를 띄우고 해제 함수를 돌려준다.
export const createSleepPreventer =
  ({ logger, platform = process.platform, spawnPowerShell = spawn }: SleepPreventerOptions) =>
  () => {
    if (platform !== 'win32') return () => undefined;

    const child = spawnPowerShell(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
      { shell: false, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
    );

    // 실패해도 전사는 계속한다. 도중에 잠들면 lease가 끝나 다시 claim된다.
    child.on('error', (error) => logger.warn({ code: codeOf(error) }, 'prevent sleep failed'));
    // PowerShell이 먼저 끝났으면 stdin 쓰기 쪽이 EPIPE를 낸다. 풀린 상태라 무시한다.
    child.stdin?.on('error', () => undefined);

    return () => {
      child.stdin?.end();
    };
  };
