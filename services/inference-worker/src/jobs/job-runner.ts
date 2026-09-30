import type { FailJobRequest, JobSnapshot, TranscriptResult } from '@echonote/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { JobLease, JobLeaseClient } from './job-lease-client.js';
import { JobLeaseClientError } from './job-lease-error.js';

const IDLE_WAIT_MS = 60_000;
const HEARTBEAT_MS = 60_000;
// lease는 DB 시계로 5분이다. 마지막으로 연장이 확인된 요청을 보낸 시점부터 30초 여유를 두고 멈춘다.
const LEASE_DEADLINE_MS = 270_000;

type AbortReason = 'stale' | 'lease_deadline' | 'shutdown';

// signal이 abort되면 처리를 멈춰야 한다. abort 뒤 결과는 버린다.
export type ProcessJob = (job: JobSnapshot, signal: AbortSignal) => Promise<TranscriptResult>;

type JobRunnerOptions = {
  client: JobLeaseClient;
  logger: Pick<FastifyBaseLogger, 'error' | 'info' | 'warn'>;
  // job 하나를 처리하는 동안 PC가 잠들지 않게 하고, 해제 함수를 돌려준다.
  preventSleep: () => () => void;
  processJob: ProcessJob;
};

// fs 오류 message에는 경로가 들어 있으므로 code만 꺼낸다.
const errorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

// 처리 함수가 던진 오류의 code를 앱에 보여 줄 실패 이유로 바꾼다.
const failureCodeOf = (code: string | undefined): FailJobRequest['errorCode'] => {
  switch (code) {
    // receiveUpload가 확정한 녹음 파일이 없다.
    case 'ENOENT':
      return 'audio_missing';

    case 'STT_DOCKER':
    case 'STT_GPU':
    case 'STT_IMAGE':
    case 'STT_MODEL':
    case 'STT_VOLUME':
      return 'stt_unavailable';

    case 'INVALID_WHISPER_OUTPUT':
    case 'STT_EXIT':
    case 'STT_TIMEOUT':
      return 'stt_failed';

    default:
      return 'unexpected';
  }
};

const reasonOf = (error: unknown) =>
  error instanceof JobLeaseClientError ? error.reason : 'unexpected';

// 시스템 시각 조정에 흔들리지 않는 단조 시계로 기한을 잰다.
const now = () => performance.now();

// 한 번에 job 하나만 처리한다. stop은 진행 중 요청과 처리 함수가 끝날 때까지 기다린다.
// 처리가 끝난 뒤의 complete는 abort하지 않는다. complete와 이어지는 fail까지 최대 20초 기다린다.
export const startJobRunner = ({ client, logger, preventSleep, processJob }: JobRunnerOptions) => {
  let stopping = false;
  // 처리가 끝난 뒤에도 응답을 기다리는 renew가 있을 수 있다. stop이 기다린다.
  // HTTP timeout(10초)이 heartbeat(60초)보다 짧아 진행 중 renew는 최대 하나다.
  let renewing: Promise<unknown> | undefined;
  let wake: (() => void) | undefined;
  let abortCurrent: ((reason: AbortReason) => void) | undefined;

  const wait = async (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);

      wake = done;
    });

  const reportFailure = async (lease: JobLease, errorCode: FailJobRequest['errorCode']) => {
    try {
      const result = await client.fail(lease, errorCode);

      logger.info({ errorCode, jobId: lease.jobId, reason: result.kind }, 'job fail reported');
    } catch (error) {
      // job은 processing으로 남고 lease가 끝나면 다시 claim된다.
      logger.warn({ jobId: lease.jobId, reason: reasonOf(error) }, 'job fail request failed');
    }
  };

  const reportCompletion = async (lease: JobLease, transcript: TranscriptResult) => {
    let result: Awaited<ReturnType<JobLeaseClient['complete']>>;

    try {
      result = await client.complete(lease, transcript);
    } catch (error) {
      const reason = reasonOf(error);

      // Gateway가 결과 형태나 크기를 거부했다. 다시 전사해도 같은 결과라 실패로 확정한다.
      if (reason === 'gateway_400' || reason === 'gateway_413') {
        logger.warn({ jobId: lease.jobId, reason }, 'job complete rejected');
        await reportFailure(lease, 'result_rejected');

        return;
      }

      // job은 processing으로 남고 lease가 끝나면 다시 claim돼 다시 전사된다.
      logger.warn({ jobId: lease.jobId, reason }, 'job complete failed');

      return;
    }

    switch (result.kind) {
      case 'completed':
        logger.info({ jobId: lease.jobId }, 'job completed');

        break;

      // 기한이 지나 다른 Worker가 가져갔거나 이미 확정됐다. 결과는 버린다.
      case 'stale':
        logger.warn({ jobId: lease.jobId }, 'job complete stale');

        break;
    }
  };

  const runClaimed = async (job: JobSnapshot, lease: JobLease, claimSentAt: number) => {
    const controller = new AbortController();
    let ended = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let deadlineAt = 0;

    const abort = (reason: AbortReason) => {
      if (controller.signal.aborted) return;

      controller.abort();
      logger.warn({ jobId: job.id, reason }, 'job aborted');
    };

    const armDeadline = (sentAt: number) => {
      clearTimeout(deadline);
      deadlineAt = sentAt + LEASE_DEADLINE_MS;
      deadline = setTimeout(() => abort('lease_deadline'), deadlineAt - now());
    };

    // 처리가 끝났거나 abort된 뒤에는 새 renew를 보내지 않는다. 진행 중 renew의 결과는 버린다.
    const isOver = () => ended || controller.signal.aborted;

    const renew = async () => {
      if (isOver()) return;

      // event loop가 밀려 heartbeat가 deadline timer보다 먼저 돌아도 기한을 넘겨 처리하지 않는다.
      if (now() >= deadlineAt) {
        abort('lease_deadline');

        return;
      }

      const sentAt = now();

      try {
        const request = client.renew(lease);

        renewing = request;

        const result = await request;

        if (isOver()) return;

        switch (result.kind) {
          case 'renewed':
            armDeadline(sentAt);
            break;

          case 'stale':
            abort('stale');

            return;
        }
      } catch (error) {
        if (isOver()) return;

        logger.warn({ jobId: job.id, reason: reasonOf(error) }, 'job lease renew failed');
      }

      heartbeat = setTimeout(() => void renew(), HEARTBEAT_MS);
    };

    abortCurrent = abort;
    armDeadline(claimSentAt);
    heartbeat = setTimeout(() => void renew(), HEARTBEAT_MS);
    logger.info({ jobId: job.id }, 'job claimed');

    let outcome:
      { kind: 'processed'; transcript: TranscriptResult } | { kind: 'threw'; error: unknown };

    try {
      outcome = { kind: 'processed', transcript: await processJob(job, controller.signal) };
    } catch (error) {
      outcome = { error, kind: 'threw' };
    } finally {
      ended = true;
      abortCurrent = undefined;
      clearTimeout(heartbeat);
      clearTimeout(deadline);
    }

    if (controller.signal.aborted) return;

    switch (outcome.kind) {
      case 'processed':
        await reportCompletion(lease, outcome.transcript);

        break;

      case 'threw': {
        const code = errorCode(outcome.error);

        logger.warn({ code, jobId: job.id }, 'job processing threw');
        await reportFailure(lease, failureCodeOf(code));

        break;
      }
    }
  };

  // 다음 claim까지 기다릴 시간을 돌려준다.
  const runOnce = async () => {
    const claimSentAt = now();
    let claim: Awaited<ReturnType<JobLeaseClient['claim']>>;

    try {
      claim = await client.claim();
    } catch (error) {
      if (!(error instanceof JobLeaseClientError)) throw error;

      logger.warn({ reason: error.reason }, 'job claim failed');

      return IDLE_WAIT_MS;
    }

    switch (claim.kind) {
      case 'idle':
        return IDLE_WAIT_MS;

      case 'claimed': {
        // 종료 중에 받은 job은 처리하지 않는다. lease가 끝나면 다시 claim된다.
        if (stopping) return 0;

        // 결과 전송까지 끝나야 해제한다.
        const release = preventSleep();

        try {
          await runClaimed(
            claim.job,
            { jobId: claim.job.id, leaseId: claim.lease.leaseId },
            claimSentAt,
          );
        } finally {
          release();
        }

        return 0;
      }
    }
  };

  const run = async () => {
    while (!stopping) {
      let delay: number;

      try {
        delay = await runOnce();
      } catch {
        logger.error({ reason: 'unexpected' }, 'job runner failed');
        delay = IDLE_WAIT_MS;
      }

      if (delay > 0 && !stopping) await wait(delay);
    }
  };

  const running = run();

  return {
    async stop() {
      stopping = true;
      wake?.();
      abortCurrent?.('shutdown');

      await running;
      await renewing?.catch(() => undefined);
    },
  };
};
