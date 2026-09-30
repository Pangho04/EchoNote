import { execFile } from 'node:child_process';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

import { type ParsedTranscript, parseWhisperOutput } from './parse-whisper-output.js';

const IMAGE = 'echonote-stt:v1';
const IMAGE_LABEL = 'stt-image-v1';
const MODEL_VOLUME = 'echonote-stt-large-v3-turbo-v1';
const RESOURCE_LABEL_KEY = 'com.echonote.resource';
const RESOURCE_LABEL = `${RESOURCE_LABEL_KEY}=stt-job-v1`;
const SELF_CHECK_NAME = 'echonote-stt-self-check';
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

const COMMAND_TIMEOUT_MS = 30_000;
// wait가 끝나지 않을 때 rm -f 시도 뒤 docker CLI를 죽이기까지 기다리는 시간이다.
const KILL_GRACE_MS = 30_000;
const JOB_CAP_MS = 60 * 60_000;
const SELF_CHECK_CAP_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

// secret이 든 Worker env를 docker CLI에 넘기지 않는다. docker 설정·자격 경로를 찾는 데 필요한 값만 넘긴다.
const DOCKER_ENV_KEYS = [
  'SystemRoot',
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
];

export type SttErrorCode =
  | 'INVALID_WHISPER_OUTPUT'
  | 'STT_DOCKER'
  | 'STT_EXIT'
  | 'STT_GPU'
  | 'STT_IMAGE'
  | 'STT_MODEL'
  | 'STT_TIMEOUT'
  | 'STT_VOLUME';

// runner와 시작 로그는 code만 남긴다. docker 출력·경로를 cause로 싣지 않는다.
export class SttError extends Error {
  constructor(readonly code: SttErrorCode) {
    super(code);
    this.name = 'SttError';
  }
}

type SttDeps = {
  dataDir: string;
  dockerPath: string;
  logger: Pick<FastifyBaseLogger, 'warn'>;
};

type DockerResult = { exitCode: number; stdout: string };

// fs 오류 message에는 경로가 들어 있으므로 문자열 code만 꺼낸다.
export const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const dockerEnv = () =>
  Object.fromEntries(
    DOCKER_ENV_KEYS.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );

// CLI가 끝까지 실행되면 exit code를 돌려준다. 실행 자체가 실패하면(없음·시간 초과·출력 초과·kill) STT_DOCKER다.
const spawnDocker = (
  dockerPath: string,
  args: string[],
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number },
) => {
  let settle!: (result: DockerResult | SttError) => void;
  const result = new Promise<DockerResult | SttError>((resolve) => {
    settle = resolve;
  });
  const child = execFile(
    dockerPath,
    args,
    {
      encoding: 'utf8',
      env: dockerEnv(),
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      signal,
      timeout: timeoutMs,
      windowsHide: true,
    },
    (error, stdout) => {
      if (error === null) {
        settle({ exitCode: 0, stdout });

        return;
      }

      settle(
        typeof error.code === 'number'
          ? { exitCode: error.code, stdout }
          : new SttError('STT_DOCKER'),
      );
    },
  );

  return { child, result };
};

const runDocker = async (
  { dockerPath }: SttDeps,
  args: string[],
  signal?: AbortSignal,
): Promise<DockerResult> => {
  const result = await spawnDocker(dockerPath, args, { signal, timeoutMs: COMMAND_TIMEOUT_MS })
    .result;

  if (result instanceof SttError) throw result;

  return result;
};

const runDockerOrThrow = async (
  deps: SttDeps,
  args: string[],
  code: SttErrorCode,
  signal?: AbortSignal,
) => {
  const { exitCode, stdout } = await runDocker(deps, args, signal);

  if (exitCode !== 0) throw new SttError(code);

  return stdout;
};

// 없는 컨테이너의 rm -f도 exit 0이다.
const removeContainer = async (deps: SttDeps, name: string) => {
  await runDockerOrThrow(deps, ['rm', '-f', name], 'STT_DOCKER');
};

const createArgs = (name: string, imageId: string, mounts: string[], command: string[] = []) => [
  'create',
  '--name',
  name,
  '--pull',
  'never',
  '--label',
  RESOURCE_LABEL,
  '--gpus',
  'all',
  '--network',
  'none',
  '--log-driver',
  'none',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--pids-limit',
  '256',
  '--env',
  'HF_HUB_OFFLINE=1',
  ...mounts.flatMap((mount) => ['--mount', mount]),
  '--mount',
  `type=volume,source=${MODEL_VOLUME},target=/model,readonly`,
  imageId,
  ...command,
];

type ContainerRun<T> = {
  args: string[];
  capMs: number;
  // 로그의 jobId 칸에 들어간다.
  logId: string;
  name: string;
  onExited: (exitCode: number) => Promise<T>;
  // 컨테이너가 결과를 쓰는 폴더다. 만들기 전에 비우고, 컨테이너 제거 뒤 지운다.
  outputDir?: string;
  signal: AbortSignal;
  timeoutCode: SttErrorCode;
};

// 컨테이너 하나를 만들어 끝날 때까지 기다리고, 어떤 경로로 끝나든 제거한다.
const runContainer = async <T>(
  deps: SttDeps,
  { args, capMs, logId, name, onExited, outputDir, signal, timeoutCode }: ContainerRun<T>,
): Promise<T> => {
  let timedOut = false;
  let removing: Promise<void> | undefined;
  let capTimer: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let waitChild: { kill(): boolean } | undefined;

  // execFile timeout은 CLI만 죽이므로 컨테이너는 rm -f로 멈춘다. rm이 wait를 끝내지 못하면 CLI를 죽인다.
  const forceRemove = () => {
    removing ??= removeContainer(deps, name)
      .catch((error: unknown) => {
        deps.logger.warn({ code: codeOf(error), jobId: logId }, 'stt remove failed');
      })
      .then(() => {
        killTimer = setTimeout(() => waitChild?.kill(), KILL_GRACE_MS);
      });
  };
  const onAbort = () => forceRemove();

  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await removeContainer(deps, name);

    if (outputDir !== undefined) {
      await rm(outputDir, { force: true, recursive: true });
      await mkdir(outputDir);
    }

    await runDockerOrThrow(deps, args, 'STT_DOCKER');
    signal.throwIfAborted();
    await runDockerOrThrow(deps, ['start', name], 'STT_DOCKER');
    signal.throwIfAborted();
    capTimer = setTimeout(() => {
      timedOut = true;
      forceRemove();
    }, capMs);

    const wait = spawnDocker(deps.dockerPath, ['wait', name], { timeoutMs: 0 });

    waitChild = wait.child;

    const waited = await wait.result;

    clearTimeout(capTimer);
    signal.throwIfAborted();

    if (timedOut) throw new SttError(timeoutCode);

    if (
      waited instanceof SttError ||
      waited.exitCode !== 0 ||
      !/^\d+$/.test(waited.stdout.trim())
    ) {
      throw new SttError('STT_DOCKER');
    }

    const value = await onExited(Number(waited.stdout.trim()));

    signal.throwIfAborted();

    return value;
  } catch (error) {
    // abort된 뒤의 오류는 원인과 관계없이 abort로 던진다. runner는 abort된 결과를 버린다.
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    clearTimeout(capTimer);
    await removing;
    clearTimeout(killTimer);

    const warnCleanup = (error: unknown) => {
      deps.logger.warn({ code: codeOf(error), jobId: logId }, 'stt cleanup failed');
    };

    // 컨테이너 제거가 실패해도 본문이 든 폴더는 지운다.
    await removeContainer(deps, name).catch(warnCleanup);

    if (outputDir !== undefined) {
      await rm(outputDir, { force: true, recursive: true }).catch(warnCleanup);
    }
  }
};

// 이전 실행이 남긴 job·self-check 컨테이너와 작업 폴더를 지운다.
export const removeStaleSttContainers = async (deps: SttDeps, signal: AbortSignal) => {
  const stdout = await runDockerOrThrow(
    deps,
    ['ps', '-aq', '--filter', `label=${RESOURCE_LABEL}`],
    'STT_DOCKER',
    signal,
  );
  const ids = stdout.split(/\s+/).filter((id) => id !== '');

  if (ids.length > 0) await runDockerOrThrow(deps, ['rm', '-f', ...ids], 'STT_DOCKER', signal);

  // fs 오류는 감싸지 않는다. 시작 로그가 errno code만 남긴다.
  await rm(join(deps.dataDir, 'stt'), { force: true, recursive: true });
  await mkdir(join(deps.dataDir, 'stt'));
};

// job을 받기 전에 docker·이미지·모델·GPU를 확인하고, job 컨테이너에 쓸 이미지 ID를 돌려준다.
export const checkSttReady = async (deps: SttDeps, signal: AbortSignal) => {
  await runDockerOrThrow(deps, ['version'], 'STT_DOCKER', signal);

  const inspected = await runDockerOrThrow(
    deps,
    [
      'image',
      'inspect',
      '--format',
      `{{.Id}} {{index .Config.Labels "${RESOURCE_LABEL_KEY}"}}`,
      IMAGE,
    ],
    'STT_IMAGE',
    signal,
  );
  const [imageId = '', label, ...rest] = inspected.trim().split(' ');

  if (!IMAGE_ID.test(imageId) || label !== IMAGE_LABEL || rest.length > 0) {
    throw new SttError('STT_IMAGE');
  }

  await runDockerOrThrow(
    deps,
    ['volume', 'inspect', '--format', '{{.Name}}', MODEL_VOLUME],
    'STT_VOLUME',
    signal,
  );
  await runContainer(deps, {
    args: createArgs(SELF_CHECK_NAME, imageId, [], ['--self-check']),
    capMs: SELF_CHECK_CAP_MS,
    logId: 'self-check',
    name: SELF_CHECK_NAME,
    onExited: async (exitCode) => {
      switch (exitCode) {
        case 0:
          return;

        case 10:
          throw new SttError('STT_GPU');

        case 11:
          throw new SttError('STT_MODEL');

        default:
          throw new SttError('STT_DOCKER');
      }
    },
    signal,
    timeoutCode: 'STT_DOCKER',
  });

  return imageId;
};

// 컨테이너가 끝난 뒤 읽는다. 바로가기·특수 파일·큰 파일은 거부하고, 확인한 그 handle로 읽는다.
const readResult = async (path: string) => {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('not a regular file');

    const handle = await open(path, 'r');

    try {
      const info = await handle.stat();

      if (!info.isFile() || info.size > MAX_RESULT_BYTES) {
        throw new Error('not a small regular file');
      }

      return parseWhisperOutput(JSON.parse(await handle.readFile('utf8')));
    } finally {
      await handle.close();
    }
  } catch {
    throw new SttError('INVALID_WHISPER_OUTPUT');
  }
};

export const createDockerTranscriber =
  ({ imageId, ...deps }: SttDeps & { imageId: string }) =>
  async (jobId: string, signal: AbortSignal): Promise<ParsedTranscript> => {
    const jobDir = join(deps.dataDir, 'stt', jobId);
    const name = `echonote-stt-${jobId}`;

    return runContainer(deps, {
      args: createArgs(name, imageId, [
        `type=bind,source=${join(deps.dataDir, 'final', `${jobId}.m4a`)},target=/input/audio.m4a,readonly`,
        `type=bind,source=${jobDir},target=/output`,
      ]),
      capMs: JOB_CAP_MS,
      logId: jobId,
      name,
      onExited: async (exitCode) => {
        if (exitCode !== 0) throw new SttError('STT_EXIT');

        return readResult(join(jobDir, 'result.json'));
      },
      outputDir: jobDir,
      signal,
      timeoutCode: 'STT_TIMEOUT',
    });
  };
