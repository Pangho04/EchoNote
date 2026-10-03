import type { TranscriptResult } from '@echonote/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobLeaseClient } from './job-lease-client.js';
import { JobLeaseClientError } from './job-lease-error.js';
import { type ProcessJob, startJobRunner } from './job-runner.js';

const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const LEASE_ID = '00000000-0000-4000-8000-0000000001f1';
const DATA_PATH = '/secret/data/final/job.m4a';
const SEGMENT_TEXT = 'segment-text-leak-probe';

const job = {
  createdAt: '2026-09-29T12:00:00.123Z',
  id: JOB_ID,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  sha256: 'e'.repeat(64),
  sizeBytes: 100,
  status: 'processing' as const,
};

const claimed = {
  job,
  kind: 'claimed' as const,
  lease: { expiresAt: '2026-09-29T12:05:00.000Z', leaseId: LEASE_ID },
};

const renewed = { expiresAt: '2026-09-29T12:05:00.000Z', kind: 'renewed' as const };

const transcript: TranscriptResult = {
  durationMs: 2_000,
  segments: [{ endMs: 1_000, startMs: 0, text: SEGMENT_TEXT }],
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
};

const enoent = () =>
  Object.assign(new Error(`ENOENT: no such file or directory, stat '${DATA_PATH}'`), {
    code: 'ENOENT',
  });

// abort될 때까지 처리 중으로 남는다.
const untilAborted: ProcessJob = async (_job, signal) =>
  new Promise((resolve) => signal.addEventListener('abort', () => resolve(transcript)));

type Harness = {
  claim?: JobLeaseClient['claim'];
  complete?: JobLeaseClient['complete'];
  fail?: JobLeaseClient['fail'];
  processJob?: ProcessJob;
  renew?: JobLeaseClient['renew'];
};

const runners: ReturnType<typeof startJobRunner>[] = [];

// 첫 claim만 claimed이고 그 뒤로는 idle이다.
const claimOnce = () => {
  let first = true;

  return async () => {
    if (!first) return { kind: 'idle' as const };

    first = false;

    return claimed;
  };
};

const start = ({
  claim = async () => ({ kind: 'idle' }),
  complete = async () => ({ kind: 'completed' }),
  fail = async () => ({ kind: 'failed' }),
  processJob = async () => transcript,
  renew = async () => renewed,
}: Harness = {}) => {
  const client = {
    claim: vi.fn(claim),
    complete: vi.fn(complete),
    fail: vi.fn(fail),
    renew: vi.fn(renew),
  };
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const process = vi.fn(processJob);
  const release = vi.fn();
  const preventSleep = vi.fn(() => release);
  const runner = startJobRunner({ client, logger, preventSleep, processJob: process });

  runners.push(runner);

  // [level, message, fields]로 펼친다.
  const logs = () =>
    (['error', 'info', 'warn'] as const).flatMap((level) =>
      logger[level].mock.calls.map(([fields, message]) => [level, message, fields] as const),
    );
  const logged = (message: string) => logs().filter(([, text]) => text === message);

  return { client, logged, logs, preventSleep, process, release, runner };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  const stopping = Promise.all(runners.splice(0).map(async (runner) => runner.stop()));

  // stop은 진행 중 renew를 기다린다. fake timer로 지연시킨 renew가 끝나도록 시간을 감는다.
  await vi.advanceTimersByTimeAsync(20_000);
  await stopping;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startJobRunner', () => {
  it('S1 idle이면 60초 기다린 뒤 다시 claim한다', async () => {
    const { client } = start();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(client.claim).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('S2 renew가 계속 성공하면 270초를 넘겨도 abort 없이 끝나고 즉시 다음 claim한다', async () => {
    const processing = deferred<TranscriptResult>();
    let signal: AbortSignal | undefined;
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: async (_job, received) => {
        signal = received;

        return processing.promise;
      },
    });

    await vi.advanceTimersByTimeAsync(400_000);
    expect(signal?.aborted).toBe(false);
    expect(client.renew).toHaveBeenCalledTimes(6);
    expect(client.renew).toHaveBeenCalledWith({ jobId: JOB_ID, leaseId: LEASE_ID });

    processing.resolve(transcript);
    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job claimed')).toHaveLength(1);
    expect(client.complete).toHaveBeenCalledExactlyOnceWith(
      { jobId: JOB_ID, leaseId: LEASE_ID },
      transcript,
    );
    expect(logged('job completed')).toEqual([['info', 'job completed', { jobId: JOB_ID }]]);
    expect(client.claim).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.renew).toHaveBeenCalledTimes(6);
  });

  it('첫 renew는 claim 응답 60초 뒤, 그 뒤는 이전 renew가 끝나고 60초 뒤다', async () => {
    const { client } = start({
      claim: claimOnce(),
      processJob: untilAborted,
      renew: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        return renewed;
      },
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(client.renew).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.renew).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(64_999);
    expect(client.renew).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.renew).toHaveBeenCalledTimes(2);
  });

  it('S3 처리 함수가 throw하면 code만 로그하고 fail을 보낸 뒤 결과를 로그하고 즉시 다음 claim한다', async () => {
    const { client, logged, logs } = start({
      claim: claimOnce(),
      processJob: async () => {
        throw enoent();
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job processing threw')).toEqual([
      ['warn', 'job processing threw', { code: 'ENOENT', jobId: JOB_ID }],
    ]);
    expect(client.fail).toHaveBeenCalledWith({ jobId: JOB_ID, leaseId: LEASE_ID }, 'audio_missing');
    expect(logged('job fail reported')).toEqual([
      [
        'info',
        'job fail reported',
        { errorCode: 'audio_missing', jobId: JOB_ID, reason: 'failed' },
      ],
    ]);
    expect(client.claim).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logs())).not.toContain(DATA_PATH);
    expect(JSON.stringify(logs())).not.toContain(LEASE_ID);
  });

  it.each([
    ['STT_DOCKER', 'stt_unavailable'],
    ['STT_GPU', 'stt_unavailable'],
    ['STT_IMAGE', 'stt_unavailable'],
    ['STT_MODEL', 'stt_unavailable'],
    ['STT_VOLUME', 'stt_unavailable'],
    ['STT_EXIT', 'stt_failed'],
    ['STT_TIMEOUT', 'stt_failed'],
    ['INVALID_WHISPER_OUTPUT', 'stt_failed'],
    ['EACCES', 'unexpected'],
    [undefined, 'unexpected'],
  ] as const)('처리 함수 오류 code %s는 %s로 fail한다', async (code, errorCode) => {
    const { client } = start({
      claim: claimOnce(),
      processJob: async () => {
        throw Object.assign(new Error('probe'), { code });
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(client.fail).toHaveBeenCalledExactlyOnceWith(
      { jobId: JOB_ID, leaseId: LEASE_ID },
      errorCode,
    );
  });

  it('claim한 job 하나마다 결과 전송이 끝날 때까지 잠자기를 막는다', async () => {
    const completing = deferred<{ kind: 'completed' }>();
    const { preventSleep, release } = start({
      claim: claimOnce(),
      complete: async () => completing.promise,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(preventSleep).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    completing.resolve({ kind: 'completed' });
    await vi.advanceTimersByTimeAsync(0);

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('idle이면 잠자기를 막지 않는다', async () => {
    const { preventSleep } = start();

    await vi.advanceTimersByTimeAsync(0);

    expect(preventSleep).not.toHaveBeenCalled();
  });

  it('S2 끝난 job의 기한 timer는 해제된다', async () => {
    const { logged } = start({ claim: claimOnce() });

    await vi.advanceTimersByTimeAsync(700_000);

    expect(logged('job completed')).toHaveLength(1);
    expect(logged('job aborted')).toHaveLength(0);
  });

  it('S3 fail이 stale이어도 결과만 로그한다', async () => {
    const { logged } = start({
      claim: claimOnce(),
      fail: async () => ({ kind: 'stale' }),
      processJob: async () => {
        throw new RangeError('no code');
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job processing threw')[0]?.[2]).toEqual({ code: undefined, jobId: JOB_ID });
    expect(logged('job fail reported')[0]?.[2]).toMatchObject({ jobId: JOB_ID, reason: 'stale' });
  });

  it('S4 renew가 stale이면 abort하고 fail 없이 처리 함수 종료를 기다린 뒤 즉시 다음 claim한다', async () => {
    const processing = deferred<TranscriptResult>();
    let signal: AbortSignal | undefined;
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: async (_job, received) => {
        signal = received;
        await processing.promise;
        throw enoent();
      },
      renew: async () => ({ kind: 'stale' }),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal?.aborted).toBe(true);
    expect(logged('job aborted')).toEqual([
      ['warn', 'job aborted', { jobId: JOB_ID, reason: 'stale' }],
    ]);
    expect(client.claim).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.renew).toHaveBeenCalledTimes(1);

    processing.resolve(transcript);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.fail).not.toHaveBeenCalled();
    expect(logged('job processing threw')).toHaveLength(0);
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('S5 renew가 계속 실패하면 마지막 성공 renew 전송 270초 뒤 abort한다', async () => {
    let signal: AbortSignal | undefined;
    let renewCount = 0;
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: async (_job, received) => {
        signal = received;

        return untilAborted(job, received);
      },
      renew: async () => {
        renewCount += 1;

        if (renewCount === 1) return renewed;

        throw new JobLeaseClientError('network');
      },
    });

    // 첫 renew(60초)만 성공한다. 기한은 60 + 270 = 330초다.
    await vi.advanceTimersByTimeAsync(329_999);
    expect(signal?.aborted).toBe(false);
    expect(logged('job lease renew failed')[0]).toEqual([
      'warn',
      'job lease renew failed',
      { jobId: JOB_ID, reason: 'network' },
    ]);

    await vi.advanceTimersByTimeAsync(1);
    expect(logged('job aborted')).toEqual([
      ['warn', 'job aborted', { jobId: JOB_ID, reason: 'lease_deadline' }],
    ]);
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('S5 기한과 renew 예정 시각이 같으면 renew를 보내지 않고 lease_deadline으로 abort한다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: untilAborted,
      // 10초 걸려 실패한다. renew는 60·130·200초에 나가고 다음 예정은 270초다.
      renew: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));

        throw new JobLeaseClientError('timeout');
      },
    });

    await vi.advanceTimersByTimeAsync(270_000);

    expect(client.renew).toHaveBeenCalledTimes(3);
    expect(logged('job aborted')[0]?.[2]).toEqual({ jobId: JOB_ID, reason: 'lease_deadline' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.renew).toHaveBeenCalledTimes(3);
  });

  it('S5 기한은 claim 응답이 아니라 claim 전송 시각부터 잰다', async () => {
    let first = true;
    const { logged } = start({
      claim: async () => {
        if (!first) return { kind: 'idle' };

        first = false;
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        return claimed;
      },
      processJob: untilAborted,
      renew: async () => {
        throw new JobLeaseClientError('network');
      },
    });

    await vi.advanceTimersByTimeAsync(269_999);
    expect(logged('job aborted')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(logged('job aborted')).toHaveLength(1);
  });

  it('S5 heartbeat 시각에 이미 기한이 지났으면 renew 없이 바로 abort한다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: untilAborted,
      renew: async () => {
        throw new JobLeaseClientError('network');
      },
    });

    // renew는 60·120·180초에 나간다. 다음 heartbeat(240초) 전에 단조 시계만 기한(270초) 뒤로 옮긴다.
    await vi.advanceTimersByTimeAsync(239_000);
    expect(client.renew).toHaveBeenCalledTimes(3);

    const fakeNow = performance.now.bind(performance);

    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow() + 40_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.renew).toHaveBeenCalledTimes(3);
    expect(logged('job aborted')).toEqual([
      ['warn', 'job aborted', { jobId: JOB_ID, reason: 'lease_deadline' }],
    ]);
  });

  it('처리가 끝난 뒤 도착한 진행 중 renew의 stale은 무시한다', async () => {
    const renewal = deferred<{ kind: 'stale' }>();
    const processing = deferred<TranscriptResult>();
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: async () => processing.promise,
      renew: async () => renewal.promise,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    processing.resolve(transcript);
    await vi.advanceTimersByTimeAsync(0);
    renewal.resolve({ kind: 'stale' });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(logged('job completed')).toHaveLength(1);
    expect(logged('job aborted')).toHaveLength(0);
    expect(client.renew).toHaveBeenCalledTimes(1);
  });

  it('renew의 예상 밖 오류는 unexpected로 로그하고 heartbeat를 이어간다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      processJob: untilAborted,
      renew: async () => {
        throw new RangeError('boom');
      },
    });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(client.renew).toHaveBeenCalledTimes(2);
    expect(logged('job lease renew failed')[0]?.[2]).toEqual({
      jobId: JOB_ID,
      reason: 'unexpected',
    });
  });

  it.each([
    [
      '분류된 실패',
      new JobLeaseClientError('gateway_503'),
      'warn',
      'job claim failed',
      'gateway_503',
    ],
    ['예상 밖 오류', new RangeError('boom'), 'error', 'job runner failed', 'unexpected'],
  ] as const)(
    'S6 claim %s는 로그 뒤 60초 기다린다',
    async (_label, error, level, message, reason) => {
      const { client, logs } = start({
        claim: async () => {
          throw error;
        },
      });

      await vi.advanceTimersByTimeAsync(59_999);
      expect(client.claim).toHaveBeenCalledTimes(1);
      expect(logs()).toEqual([[level, message, { reason }]]);

      await vi.advanceTimersByTimeAsync(1);
      expect(client.claim).toHaveBeenCalledTimes(2);
    },
  );

  it('S7 fail 요청이 실패하면 로그만 남기고 즉시 다음 claim한다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      fail: async () => {
        throw new JobLeaseClientError('timeout');
      },
      processJob: async () => {
        throw enoent();
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job fail request failed')).toEqual([
      ['warn', 'job fail request failed', { jobId: JOB_ID, reason: 'timeout' }],
    ]);
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('S7 fail의 예상 밖 오류도 unexpected로 로그하고 즉시 다음 claim한다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      fail: async () => {
        throw new RangeError('boom');
      },
      processJob: async () => {
        throw enoent();
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job fail request failed')[0]?.[2]).toEqual({
      jobId: JOB_ID,
      reason: 'unexpected',
    });
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('S8 대기 중 stop은 대기를 끝내고 claim하지 않는다', async () => {
    const { client, runner } = start();

    await vi.advanceTimersByTimeAsync(10_000);
    await runner.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('S8 처리 중 stop은 shutdown으로 abort하고 처리 함수 종료까지 기다린다', async () => {
    const processing = deferred<TranscriptResult>();
    let signal: AbortSignal | undefined;
    const { client, logged, runner } = start({
      claim: claimOnce(),
      processJob: async (_job, received) => {
        signal = received;

        return processing.promise;
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(logged('job aborted')[0]?.[2]).toEqual({ jobId: JOB_ID, reason: 'shutdown' });
    expect(stopped).toBe(false);

    processing.resolve(transcript);
    await stopping;

    expect(logged('job completed')).toHaveLength(0);
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('S8 진행 중 claim은 끝을 기다리고 claimed여도 처리하지 않는다', async () => {
    const claiming = deferred<typeof claimed>();
    const { client, process, runner } = start({ claim: async () => claiming.promise });

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    claiming.resolve(claimed);
    await stopping;

    expect(process).not.toHaveBeenCalled();
    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('S8 처리가 끝난 뒤에도 진행 중인 renew는 stop이 끝을 기다린다', async () => {
    const renewal = deferred<typeof renewed>();
    const processing = deferred<TranscriptResult>();
    const { runner } = start({
      claim: claimOnce(),
      processJob: async () => processing.promise,
      renew: async () => renewal.promise,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    processing.resolve(transcript);
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    renewal.resolve(renewed);
    await stopping;
  });

  it('S8 진행 중인 fail 요청은 stop이 끝을 기다린다', async () => {
    const failing = deferred<{ kind: 'failed' }>();
    const { client, runner } = start({
      claim: claimOnce(),
      fail: async () => failing.promise,
      processJob: async () => {
        throw enoent();
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(client.fail).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    failing.resolve({ kind: 'failed' });
    await stopping;

    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('처리 함수가 abort를 무시해도 shutdown 뒤에는 renew를 보내지 않는다', async () => {
    const processing = deferred<TranscriptResult>();
    const { client, runner } = start({
      claim: claimOnce(),
      processJob: async () => processing.promise,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    const stopping = runner.stop();

    // 60초에 예약된 heartbeat가 돌지만 기한 전이라도 보내지 않는다.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.renew).not.toHaveBeenCalled();

    processing.resolve(transcript);
    await stopping;
  });

  it.each([
    ['renewed', (renewal: ReturnType<typeof deferred<typeof renewed>>) => renewal.resolve(renewed)],
    [
      'network 실패',
      (renewal: ReturnType<typeof deferred<typeof renewed>>) =>
        renewal.reject(new JobLeaseClientError('network')),
    ],
  ] as const)(
    'abort 뒤 도착한 renew 결과(%s)는 버리고 renew를 다시 예약하지 않는다',
    async (_label, settle) => {
      const processing = deferred<TranscriptResult>();
      const renewal = deferred<typeof renewed>();
      const { client, logged, runner } = start({
        claim: claimOnce(),
        processJob: async () => processing.promise,
        renew: async () => renewal.promise,
      });

      await vi.advanceTimersByTimeAsync(60_000);

      const stopping = runner.stop();

      settle(renewal);
      await vi.advanceTimersByTimeAsync(0);

      // claim 기준 deadline timer만 남는다. 결과를 반영했다면 heartbeat가 더해진다.
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(client.renew).toHaveBeenCalledTimes(1);
      expect(logged('job aborted')).toEqual([
        ['warn', 'job aborted', { jobId: JOB_ID, reason: 'shutdown' }],
      ]);
      expect(logged('job lease renew failed')).toHaveLength(0);

      processing.resolve(transcript);
      await stopping;
    },
  );

  it('S8 이미 stale로 abort된 job은 shutdown에서 다시 로그하지 않는다', async () => {
    const processing = deferred<TranscriptResult>();
    const { logged, runner } = start({
      claim: claimOnce(),
      processJob: async () => processing.promise,
      renew: async () => ({ kind: 'stale' }),
    });

    await vi.advanceTimersByTimeAsync(60_000);

    const stopping = runner.stop();

    processing.resolve(transcript);
    await stopping;

    expect(logged('job aborted')).toEqual([
      ['warn', 'job aborted', { jobId: JOB_ID, reason: 'stale' }],
    ]);
  });

  it('S9 성공한 job은 complete를 한 번만 보내고 fail·renew는 보내지 않는다', async () => {
    const { client, logs } = start({ claim: claimOnce() });

    await vi.advanceTimersByTimeAsync(0);

    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.renew).not.toHaveBeenCalled();
    expect(JSON.stringify(logs())).not.toContain(SEGMENT_TEXT);
    expect(JSON.stringify(logs())).not.toContain(LEASE_ID);
  });

  it('complete가 stale이면 경고만 남기고 fail 없이 즉시 다음 claim한다', async () => {
    const { client, logged } = start({
      claim: claimOnce(),
      complete: async () => ({ kind: 'stale' }),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job complete stale')).toEqual([
      ['warn', 'job complete stale', { jobId: JOB_ID }],
    ]);
    expect(logged('job completed')).toHaveLength(0);
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it.each(['gateway_400', 'gateway_413'] as const)(
    'Gateway가 결과를 거부(%s)하면 fail을 한 번 보낸다',
    async (reason) => {
      const { client, logged } = start({
        claim: claimOnce(),
        complete: async () => {
          throw new JobLeaseClientError(reason);
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(logged('job complete rejected')).toEqual([
        ['warn', 'job complete rejected', { jobId: JOB_ID, reason }],
      ]);
      expect(client.fail).toHaveBeenCalledExactlyOnceWith(
        { jobId: JOB_ID, leaseId: LEASE_ID },
        'result_rejected',
      );
      expect(logged('job fail reported')).toHaveLength(1);
      expect(client.claim).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    'gateway_200',
    'gateway_302',
    'gateway_401',
    'gateway_404',
    'gateway_408',
    'gateway_409',
    'gateway_429',
    'gateway_500',
    'gateway_503',
    'timeout',
    'network',
    'invalid_response',
  ] as const)('complete 실패(%s)는 경고만 남기고 fail하지 않는다', async (reason) => {
    const { client, logged } = start({
      claim: claimOnce(),
      complete: async () => {
        throw new JobLeaseClientError(reason);
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job complete failed')).toEqual([
      ['warn', 'job complete failed', { jobId: JOB_ID, reason }],
    ]);
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('complete의 예상 밖 오류는 unexpected로 경고하고 fail하지 않는다', async () => {
    const { client, logged, logs } = start({
      claim: claimOnce(),
      complete: async () => {
        throw new RangeError(`${SEGMENT_TEXT} ${LEASE_ID}`);
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(logged('job complete failed')).toEqual([
      ['warn', 'job complete failed', { jobId: JOB_ID, reason: 'unexpected' }],
    ]);
    expect(client.fail).not.toHaveBeenCalled();
    expect(JSON.stringify(logs())).not.toContain(SEGMENT_TEXT);
    expect(JSON.stringify(logs())).not.toContain(LEASE_ID);
  });

  it('abort된 job은 처리 함수가 결과를 돌려줘도 complete하지 않는다', async () => {
    const { client } = start({
      claim: claimOnce(),
      processJob: untilAborted,
      renew: async () => ({ kind: 'stale' }),
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it('S8 진행 중인 complete는 abort하지 않고 stop이 끝을 기다린다', async () => {
    const completing = deferred<{ kind: 'completed' }>();
    const { client, logged, runner } = start({
      claim: claimOnce(),
      complete: async () => completing.promise,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(client.complete).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    completing.resolve({ kind: 'completed' });
    await stopping;

    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(logged('job aborted')).toHaveLength(0);
    expect(logged('job completed')).toHaveLength(1);
    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('S8 거부된 complete 뒤의 fail도 stop이 끝을 기다린다', async () => {
    const completing = deferred<{ kind: 'completed' }>();
    const failing = deferred<{ kind: 'failed' }>();
    const { client, runner } = start({
      claim: claimOnce(),
      complete: async () => completing.promise,
      fail: async () => failing.promise,
    });

    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    completing.reject(new JobLeaseClientError('gateway_400'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.fail).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);

    failing.resolve({ kind: 'failed' });
    await stopping;

    expect(client.fail).toHaveBeenCalledTimes(1);
    expect(client.claim).toHaveBeenCalledTimes(1);
  });

  it('idle 대기 중 wake하면 60초를 기다리지 않고 바로 다시 claim한다', async () => {
    const { client, runner } = start();

    await vi.advanceTimersByTimeAsync(0);
    expect(client.claim).toHaveBeenCalledTimes(1);

    runner.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.claim).toHaveBeenCalledTimes(2);
  });

  it('claim 요청 중에 wake하면 그 claim이 idle이어도 바로 다시 claim한다', async () => {
    const claiming = deferred<{ kind: 'idle' }>();
    const { client, runner } = start({
      claim: vi
        .fn<JobLeaseClient['claim']>()
        .mockImplementationOnce(async () => claiming.promise)
        .mockResolvedValue({ kind: 'idle' }),
    });

    await vi.advanceTimersByTimeAsync(0);
    runner.wake();
    claiming.resolve({ kind: 'idle' });
    await vi.advanceTimersByTimeAsync(0);

    expect(client.claim).toHaveBeenCalledTimes(2);
  });
});
