import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  checkSttReady,
  createDockerTranscriber,
  removeStaleSttContainers,
} from './docker-transcriber.js';
import type * as parser from './parse-whisper-output.js';
import { parseWhisperOutput } from './parse-whisper-output.js';

type Reply = { exitCode?: number; stdout?: string } | 'cli-failure';

type Call = {
  args: string[];
  file: string;
  kill: ReturnType<typeof vi.fn>;
  options: Record<string, unknown>;
};

type ExecCallback = (error: (Error & { code?: unknown }) | null, stdout: string) => void;

// execFile을 가짜로 바꾸고 docker 명령마다 응답을 정한다.
const fake = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (_args: string[]): unknown => ({}),
}));

// 결과를 읽는 도중의 abort를 이벤트 루프 순서와 무관하게 만들려고 parser를 감싼다.
vi.mock('./parse-whisper-output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof parser>();

  return { ...actual, parseWhisperOutput: vi.fn(actual.parseWhisperOutput) };
});

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    callback: ExecCallback,
  ) => {
    let settled = false;

    const finish = (error: (Error & { code?: unknown }) | null, stdout = '') => {
      if (settled) return;

      settled = true;
      callback(error, stdout);
    };
    const kill = vi.fn(() => {
      finish(Object.assign(new Error('killed'), { code: null }));

      return true;
    });

    fake.calls.push({ args, file, kill, options });
    void Promise.resolve(fake.respond(args)).then((reply) => {
      const answer = reply as Reply;

      if (answer === 'cli-failure') {
        finish(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));

        return;
      }

      const { exitCode = 0, stdout = '' } = answer;

      finish(exitCode === 0 ? null : Object.assign(new Error('exit'), { code: exitCode }), stdout);
    });

    return { kill };
  },
}));

const DOCKER_PATH = '/usr/local/bin/docker';
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const SECRET = 'worker-secret-token-value';
const TRANSCRIPT_TEXT = '회의 본문 문장';

const result = {
  durationMs: 2_000,
  schemaVersion: 1,
  segments: [{ endMs: 1_000, startMs: 0, text: TRANSCRIPT_TEXT }],
};

let dataDir: string;
let logger: { warn: Mock<(...args: unknown[]) => void> };

const calls = () => fake.calls as Call[];
const commands = () => calls().map(({ args }) => args.slice(0, 2).join(' '));
const deps = () => ({ dataDir, dockerPath: DOCKER_PATH, logger });
const jobDir = () => join(dataDir, 'stt', JOB_ID);
const pending = () => new Promise<Reply>(() => undefined);
const ALLOWED_ENV = [
  'SystemRoot',
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
];

// 가짜 타이머는 setTimeout만 바꾼다. fs I/O가 끝나 wait가 시작될 때까지 실제 시간으로 기다린다.
const useFakeTimeouts = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const untilWaitStarted = async () => {
  while (!calls().some(({ args }) => args[0] === 'wait')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// rm -f가 올 때까지 wait를 붙잡는다. 실제 docker wait는 컨테이너가 제거되면 끝난다.
const holdWaitUntilRemoved = () => {
  let release: ((reply: Reply) => void) | undefined;

  return (args: string[]): Reply | Promise<Reply> => {
    if (args[0] === 'wait') return new Promise<Reply>((resolve) => (release = resolve));

    if (args[0] === 'rm') release?.({ stdout: '137\n' });

    return {};
  };
};

// 정상 컨테이너: start 때 결과 파일을 쓰고 wait는 exit code를 돌려준다.
const containerWrites =
  (content: string, exitStdout = '0\n') =>
  async (args: string[]): Promise<Reply> => {
    if (args[0] === 'start') await writeFile(join(jobDir(), 'result.json'), content);

    if (args[0] === 'wait') return { stdout: exitStdout };

    return {};
  };

const captureRejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('promise did not reject');
};

const transcribe = (signal = new AbortController().signal) =>
  createDockerTranscriber({ ...deps(), imageId: IMAGE_ID })(JOB_ID, signal);

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'echonote-stt-'));
  await mkdir(join(dataDir, 'stt'));
  fake.calls = [];
  fake.respond = () => ({});
  logger = { warn: vi.fn() };
  vi.stubEnv('WORKER_API_TOKEN', SECRET);
  vi.stubEnv('PATH', '/usr/bin');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(dataDir, { force: true, recursive: true });
});

describe('docker 호출 공통', () => {
  it('shell 없이, 창 없이, 허용한 env만 넘기고 출력·시간 상한을 둔다', async () => {
    fake.respond = containerWrites(JSON.stringify(result));

    await transcribe();

    for (const { args, file, options } of calls()) {
      expect(file).toBe(DOCKER_PATH);
      expect(options).toMatchObject({ maxBuffer: 64 * 1024, shell: false, windowsHide: true });
      expect(options.timeout).toBe(args[0] === 'wait' ? 0 : 30_000);
      expect(ALLOWED_ENV).toEqual(expect.arrayContaining(Object.keys(options.env as object)));
      expect(options.env).toMatchObject({ PATH: '/usr/bin' });
      expect(JSON.stringify(options.env)).not.toContain(SECRET);
    }
  });

  it('create 인자는 격리 옵션·mount 3개·사전 확인 이미지 ID로 고정한다', async () => {
    fake.respond = containerWrites(JSON.stringify(result));

    await transcribe();

    expect(calls().find(({ args }) => args[0] === 'create')?.args).toEqual([
      'create',
      '--name',
      `echonote-stt-${JOB_ID}`,
      '--pull',
      'never',
      '--label',
      'com.echonote.resource=stt-job-v1',
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
      '--mount',
      `type=bind,source=${join(dataDir, 'final', `${JOB_ID}.m4a`)},target=/input/audio.m4a,readonly`,
      '--mount',
      `type=bind,source=${jobDir()},target=/output`,
      '--mount',
      'type=volume,source=echonote-stt-large-v3-turbo-v1,target=/model,readonly',
      IMAGE_ID,
    ]);
  });
});

describe('removeStaleSttContainers', () => {
  it('남은 컨테이너가 없으면 rm 없이 stt 폴더만 비운다', async () => {
    await writeFile(join(dataDir, 'stt', 'left.json'), '{}');
    fake.respond = () => ({ stdout: '' });

    await removeStaleSttContainers(deps(), new AbortController().signal);

    expect(calls().map(({ args }) => args)).toEqual([
      ['ps', '-aq', '--filter', 'label=com.echonote.resource=stt-job-v1'],
    ]);
    expect(await readdir(join(dataDir, 'stt'))).toEqual([]);
  });

  it('label이 붙은 컨테이너를 모두 rm -f한다', async () => {
    fake.respond = (args) => (args[0] === 'ps' ? { stdout: 'c1\nc2\n' } : {});

    await removeStaleSttContainers(deps(), new AbortController().signal);

    expect(calls()[1]?.args).toEqual(['rm', '-f', 'c1', 'c2']);
  });

  it.each([
    ['ps 비0', () => ({ exitCode: 1 })],
    ['ps CLI 실패', (): Reply => 'cli-failure'],
    ['rm 비0', (args: string[]) => (args[0] === 'ps' ? { stdout: 'c1' } : { exitCode: 1 })],
  ])('%s면 STT_DOCKER', async (_label, respond) => {
    fake.respond = respond;

    await expect(
      removeStaleSttContainers(deps(), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'STT_DOCKER' });
  });

  it('작업 폴더를 만들 수 없으면 fs 오류 code를 그대로 던진다', async () => {
    fake.respond = () => ({ stdout: '' });

    await expect(
      removeStaleSttContainers(
        { ...deps(), dataDir: join(dataDir, 'missing') },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('signal을 docker CLI에 넘긴다', async () => {
    const controller = new AbortController();

    fake.respond = () => ({ stdout: '' });
    await removeStaleSttContainers(deps(), controller.signal);

    expect(calls()[0]?.options.signal).toBe(controller.signal);
  });
});

describe('checkSttReady', () => {
  const ready =
    (overrides: Partial<Record<string, Reply>> = {}, selfCheckExit = '0\n') =>
    (args: string[]): Reply =>
      overrides[args[0]!] ??
      (args[0] === 'image'
        ? { stdout: `${IMAGE_ID} stt-image-v1\n` }
        : args[0] === 'wait'
          ? { stdout: selfCheckExit }
          : {});

  it('docker·이미지·volume·self-check를 차례로 확인하고 이미지 ID를 돌려준다', async () => {
    fake.respond = ready();

    await expect(checkSttReady(deps(), new AbortController().signal)).resolves.toBe(IMAGE_ID);
    expect(commands()).toEqual([
      'version',
      'image inspect',
      'volume inspect',
      'rm -f',
      'create --name',
      'start echonote-stt-self-check',
      'wait echonote-stt-self-check',
      'rm -f',
    ]);

    const create = calls().find(({ args }) => args[0] === 'create')!.args;

    expect(create.filter((arg) => arg.startsWith('type=bind'))).toEqual([]);
    expect(create.slice(-2)).toEqual([IMAGE_ID, '--self-check']);
    expect(create[2]).toBe('echonote-stt-self-check');
  });

  it.each([
    ['version 비0', { version: { exitCode: 1 } }, '0', 'STT_DOCKER'],
    ['version CLI 실패', { version: 'cli-failure' as const }, '0', 'STT_DOCKER'],
    ['image inspect 비0', { image: { exitCode: 1 } }, '0', 'STT_IMAGE'],
    ['label 불일치', { image: { stdout: `${IMAGE_ID} stt-benchmark-image-v1` } }, '0', 'STT_IMAGE'],
    ['label 없음', { image: { stdout: `${IMAGE_ID} <no value>` } }, '0', 'STT_IMAGE'],
    ['ID 형식 아님', { image: { stdout: 'sha256:abc stt-image-v1' } }, '0', 'STT_IMAGE'],
    [
      'inspect 출력 토큰 초과',
      { image: { stdout: `${IMAGE_ID} stt-image-v1 x` } },
      '0',
      'STT_IMAGE',
    ],
    ['volume 비0', { volume: { exitCode: 1 } }, '0', 'STT_VOLUME'],
    ['self-check exit 10', {}, '10', 'STT_GPU'],
    ['self-check exit 11', {}, '11', 'STT_MODEL'],
    ['self-check exit 1', {}, '1', 'STT_DOCKER'],
    ['self-check create 비0', { create: { exitCode: 125 } }, '0', 'STT_DOCKER'],
  ])('%s면 code가 맞다', async (_label, overrides, selfCheckExit, code) => {
    fake.respond = ready(overrides, selfCheckExit);

    await expect(checkSttReady(deps(), new AbortController().signal)).rejects.toMatchObject({
      code,
    });
  });

  it('self-check가 60초를 넘기면 컨테이너를 제거하고 STT_DOCKER', async () => {
    useFakeTimeouts();

    const hold = holdWaitUntilRemoved();

    fake.respond = (args) => (args[0] === 'image' ? ready()(args) : hold(args));

    const checking = captureRejection(checkSttReady(deps(), new AbortController().signal));

    await untilWaitStarted();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await checking).toMatchObject({ code: 'STT_DOCKER' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('self-check 중 종료 신호가 오면 컨테이너를 제거하고 abort로 끝난다', async () => {
    const controller = new AbortController();
    const hold = holdWaitUntilRemoved();

    fake.respond = (args) => {
      if (args[0] === 'wait') queueMicrotask(() => controller.abort());

      return args[0] === 'image' ? ready()(args) : hold(args);
    };

    expect(await captureRejection(checkSttReady(deps(), controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    expect(commands().filter((command) => command === 'rm -f')).toHaveLength(3);
  });
});

describe('createDockerTranscriber', () => {
  it('컨테이너 결과를 검증해 돌려주고 컨테이너·작업 폴더·타이머를 남기지 않는다', async () => {
    useFakeTimeouts();
    fake.respond = containerWrites(JSON.stringify(result));

    await expect(transcribe()).resolves.toEqual(result);
    expect(commands()).toEqual([
      'rm -f',
      'create --name',
      `start echonote-stt-${JOB_ID}`,
      `wait echonote-stt-${JOB_ID}`,
      'rm -f',
    ]);
    await expect(stat(jobDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('작업 폴더를 만들 수 없으면 create하지 않고 fs 오류 code를 그대로 던진다', async () => {
    await rm(join(dataDir, 'stt'), { force: true, recursive: true });

    await expect(transcribe()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commands()).toEqual(['rm -f', 'rm -f']);
  });

  it('result.json이 16MiB를 넘으면 INVALID_WHISPER_OUTPUT', async () => {
    fake.respond = async (args) => {
      if (args[0] === 'start') {
        await writeFile(join(jobDir(), 'result.json'), Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
      }

      return args[0] === 'wait' ? { stdout: '0' } : {};
    };

    await expect(transcribe()).rejects.toMatchObject({ code: 'INVALID_WHISPER_OUTPUT' });
  });

  it('create 전에 이전 결과를 비운다', async () => {
    await mkdir(jobDir());
    await writeFile(join(jobDir(), 'result.json'), JSON.stringify(result));
    fake.respond = (args) => (args[0] === 'wait' ? { stdout: '0' } : {});

    await expect(transcribe()).rejects.toMatchObject({ code: 'INVALID_WHISPER_OUTPUT' });
  });

  it.each([
    ['exit 1', containerWrites(JSON.stringify(result), '1\n'), 'STT_EXIT'],
    [
      'wait CLI 실패',
      (args: string[]): Reply => (args[0] === 'wait' ? 'cli-failure' : {}),
      'STT_DOCKER',
    ],
    ['wait 비0', (args: string[]) => (args[0] === 'wait' ? { exitCode: 1 } : {}), 'STT_DOCKER'],
    ['wait 출력이 정수 아님', containerWrites(JSON.stringify(result), 'oops'), 'STT_DOCKER'],
    [
      'create 비0',
      (args: string[]) => (args[0] === 'create' ? { exitCode: 125 } : {}),
      'STT_DOCKER',
    ],
    ['start 비0', (args: string[]) => (args[0] === 'start' ? { exitCode: 1 } : {}), 'STT_DOCKER'],
    ['사전 rm 비0', (args: string[]) => (args[0] === 'rm' ? { exitCode: 1 } : {}), 'STT_DOCKER'],
    [
      '결과 파일 없음',
      (args: string[]) => (args[0] === 'wait' ? { stdout: '0' } : {}),
      'INVALID_WHISPER_OUTPUT',
    ],
    ['JSON 아님', containerWrites('{'), 'INVALID_WHISPER_OUTPUT'],
    [
      '계약 위반',
      containerWrites(JSON.stringify({ ...result, schemaVersion: 2 })),
      'INVALID_WHISPER_OUTPUT',
    ],
  ])('%s면 %s', async (_label, respond, code) => {
    fake.respond = respond;

    const error = await captureRejection(transcribe());

    expect(error).toMatchObject({ code, message: code });
    expect((error as Error).cause).toBeUndefined();
  });

  it('result.json이 바로가기면 따라가지 않고 INVALID_WHISPER_OUTPUT', async () => {
    const outside = join(dataDir, 'outside.json');

    await writeFile(outside, JSON.stringify(result));
    fake.respond = async (args) => {
      if (args[0] === 'start') await symlink(outside, join(jobDir(), 'result.json'));

      return args[0] === 'wait' ? { stdout: '0' } : {};
    };

    await expect(transcribe()).rejects.toMatchObject({ code: 'INVALID_WHISPER_OUTPUT' });
  });

  it('result.json이 폴더면 INVALID_WHISPER_OUTPUT', async () => {
    fake.respond = async (args) => {
      if (args[0] === 'start') await mkdir(join(jobDir(), 'result.json'));

      return args[0] === 'wait' ? { stdout: '0' } : {};
    };

    await expect(transcribe()).rejects.toMatchObject({ code: 'INVALID_WHISPER_OUTPUT' });
  });

  it('create 중 abort면 start하지 않고 컨테이너를 제거한다', async () => {
    const controller = new AbortController();

    fake.respond = (args) => {
      if (args[0] === 'create') controller.abort();

      return {};
    };

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    expect(commands()).toEqual(['rm -f', 'create --name', 'rm -f', 'rm -f']);
  });

  it('abort 뒤 docker 명령이 실패해도 STT_DOCKER가 아니라 abort로 끝난다', async () => {
    const controller = new AbortController();

    fake.respond = (args) => {
      if (args[0] !== 'create') return {};

      controller.abort();

      return { exitCode: 125 };
    };

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
  });

  it('결과를 읽는 중 abort면 결과를 버리고 폴더·타이머를 남기지 않는다', async () => {
    useFakeTimeouts();

    const controller = new AbortController();
    const parse = vi.mocked(parseWhisperOutput);
    const actual = parse.getMockImplementation()!;

    fake.respond = containerWrites(JSON.stringify(result));
    parse.mockImplementationOnce((raw) => {
      controller.abort();

      return actual(raw);
    });

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    await expect(stat(jobDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('이미 abort된 signal이면 create 뒤 멈춘다', async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    expect(commands()).toEqual(['rm -f', 'create --name', 'rm -f']);
  });

  it('start 중 abort면 wait하지 않는다', async () => {
    const controller = new AbortController();

    fake.respond = (args) => {
      if (args[0] === 'start') controller.abort();

      return {};
    };

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    expect(commands()).not.toContain(`wait echonote-stt-${JOB_ID}`);
    await expect(stat(jobDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('wait 중 abort면 rm -f로 컨테이너를 멈추고 결과를 읽지 않는다', async () => {
    const controller = new AbortController();
    const hold = holdWaitUntilRemoved();

    fake.respond = (args) => {
      if (args[0] === 'wait') queueMicrotask(() => controller.abort());

      return hold(args);
    };

    expect(await captureRejection(transcribe(controller.signal))).toMatchObject({
      name: 'AbortError',
    });
    expect(commands().slice(-2)).toEqual(['rm -f', 'rm -f']);
    await expect(stat(jobDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('60분을 넘기면 컨테이너를 제거하고 STT_TIMEOUT, 타이머를 남기지 않는다', async () => {
    useFakeTimeouts();
    fake.respond = holdWaitUntilRemoved();

    const running = captureRejection(transcribe());

    await untilWaitStarted();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(await running).toMatchObject({ code: 'STT_TIMEOUT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rm -f가 실패하고 wait가 30초 안에 안 끝나면 CLI를 죽이고 경로 없이 로그를 남긴다', async () => {
    useFakeTimeouts();

    const controller = new AbortController();
    let waitStarted = false;

    fake.respond = (args) => {
      if (args[0] === 'wait') {
        waitStarted = true;

        return pending();
      }

      return args[0] === 'rm' && waitStarted ? { exitCode: 1 } : {};
    };

    const running = captureRejection(transcribe(controller.signal));

    await untilWaitStarted();
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await running).toMatchObject({ name: 'AbortError' });
    expect(calls().find(({ args }) => args[0] === 'wait')?.kill).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { code: 'STT_DOCKER', jobId: JOB_ID },
      'stt remove failed',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { code: 'STT_DOCKER', jobId: JOB_ID },
      'stt cleanup failed',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(dataDir);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('정리 rm이 실패해도 결과는 돌려주고 본문 없이 로그를 남긴다', async () => {
    const write = containerWrites(JSON.stringify(result));
    let waited = false;

    fake.respond = async (args) => {
      if (args[0] === 'wait') waited = true;

      return args[0] === 'rm' && waited ? { exitCode: 1 } : write(args);
    };

    await expect(transcribe()).resolves.toEqual(result);
    await expect(stat(jobDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logger.warn).toHaveBeenCalledWith(
      { code: 'STT_DOCKER', jobId: JOB_ID },
      'stt cleanup failed',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TRANSCRIPT_TEXT);
  });
});
