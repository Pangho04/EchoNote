import type { JobSnapshot } from '@echonote/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { JobLease, JobLeaseClient } from './job-lease-client.js';
import { JobLeaseClientError } from './job-lease-error.js';

const IDLE_WAIT_MS = 60_000;
const HEARTBEAT_MS = 60_000;
// lease는 DB 시계로 5분이다. 마지막으로 연장이 확인된 요청을 보낸 시점부터 30초 여유를 두고 멈춘다.
const LEASE_DEADLINE_MS = 270_000;

type AbortReason = 'stale' | 'lease_deadline' | 'shutdown';

// signal이 abort되면 처리를 멈춰야 한다. abort 뒤 결과는 버린다.
export type ProcessJob = (job: JobSnapshot, signal: AbortSignal) => Promise<void>;

type JobRunnerOptions = {
  client: JobLeaseClient;
  logger: Pick<FastifyBaseLogger, 'error' | 'info' | 'warn'>;
  processJob: ProcessJob;
};

// fs 오류 message에는 경로가 들어 있으므로 code만 꺼낸다.
const errorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const reasonOf = (error: unknown) =>
  error instanceof JobLeaseClientError ? error.reason : 'unexpected';

// 시스템 시각 조정에 흔들리지 않는 단조 시계로 기한을 잰다.
const now = () => performance.now();

// 한 번에 job 하나만 처리한다. stop은 진행 중 요청과 처리 함수가 끝날 때까지 기다린다.
export const startJobRunner = ({ client, logger, processJob }: JobRunnerOptions) => {
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

  const reportFailure = async (lease: JobLease) => {
    try {
      const result = await client.fail(lease);

      logger.info({ jobId: lease.jobId, reason: result.kind }, 'job fail reported');
    } catch (error) {
      // job은 processing으로 남고 lease가 끝나면 다시 claim된다.
      logger.warn({ jobId: lease.jobId, reason: reasonOf(error) }, 'job fail request failed');
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

    let failure: { error: unknown } | undefined;

    try {
      await processJob(job, controller.signal);
    } catch (error) {
      failure = { error };
    } finally {
      ended = true;
      abortCurrent = undefined;
      clearTimeout(heartbeat);
      clearTimeout(deadline);
    }

    if (controller.signal.aborted) return;

    if (failure === undefined) {
      logger.info({ jobId: job.id }, 'job succeeded');

      return;
    }

    logger.warn({ code: errorCode(failure.error), jobId: job.id }, 'job processing threw');
    await reportFailure(lease);
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

      case 'claimed':
        // 종료 중에 받은 job은 처리하지 않는다. lease가 끝나면 다시 claim된다.
        if (stopping) return 0;

        await runClaimed(
          claim.job,
          { jobId: claim.job.id, leaseId: claim.lease.leaseId },
          claimSentAt,
        );

        return 0;
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
