import {
  type ClaimJobResponse,
  claimJobResponseSchema,
  renewJobLeaseResponseSchema,
} from '@echonote/contracts';
import { z } from 'zod';

import { JobLeaseClientError } from './job-lease-error.js';

const TIMEOUT_MS = 10_000;

const leaseStaleSchema = z.object({ error: z.literal('lease_stale') });

export type JobLease = { jobId: string; leaseId: string };

export type JobLeaseClient = {
  claim(): Promise<({ kind: 'claimed' } & ClaimJobResponse) | { kind: 'idle' }>;
  renew(lease: JobLease): Promise<{ kind: 'renewed'; expiresAt: string } | { kind: 'stale' }>;
  fail(lease: JobLease): Promise<{ kind: 'failed' } | { kind: 'stale' }>;
};

type JobLeaseClientOptions = {
  gatewayOrigin: string;
  // loadEnvironment로 검증한 값만 받는다. new Headers의 TypeError 문구가 값을 담는다.
  workerApiToken: string;
};

// 원본 오류를 cause로 잇지 않는다. 분류 코드만 남긴다.
const classify = (error: unknown) => {
  // AbortSignal.timeout이 만료되면 fetch와 body 읽기는 name이 TimeoutError인 DOMException으로 reject한다.
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new JobLeaseClientError('timeout');
  }

  // fetch는 연결 실패를 TypeError로 reject한다. cause에 주소가 들어 있다.
  if (error instanceof TypeError) return new JobLeaseClientError('network');

  if (error instanceof SyntaxError) return new JobLeaseClientError('invalid_response');

  return error;
};

export const createJobLeaseClient = ({
  gatewayOrigin,
  workerApiToken,
}: JobLeaseClientOptions): JobLeaseClient => {
  const headers = new Headers({
    authorization: `Bearer ${workerApiToken}`,
    'content-type': 'application/json',
  });

  const post = async (path: string, body: unknown) => {
    try {
      return await fetch(new URL(path, gatewayOrigin), {
        body: JSON.stringify(body),
        headers,
        method: 'POST',
        // 3xx를 따라가면 token이 다른 origin으로 갈 수 있다. gateway_3xx로 처리한다.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw classify(error);
    }
  };

  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch (error) {
      throw classify(error);
    }
  };

  const discard = async (response: Response) => {
    // 응답 body는 쓰지 않는다. 연결을 붙잡지 않도록 버린다.
    await response.body?.cancel().catch(() => undefined);
  };

  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const parsed = schema.safeParse(value);

    if (!parsed.success) throw new JobLeaseClientError('invalid_response');

    return parsed.data;
  };

  // renew·fail이 공유한다. 409 lease_stale만 stale이고 다른 409는 gateway_409다.
  const isLeaseStale = async (response: Response) => {
    if (response.status !== 409) return false;

    try {
      return leaseStaleSchema.safeParse(await readJson(response)).success;
    } catch (error) {
      // JSON이 아닌 409는 lease_stale이 아니다. 호출자가 gateway_409로 처리한다.
      if (error instanceof JobLeaseClientError && error.reason === 'invalid_response') return false;

      throw error;
    }
  };

  return {
    async claim() {
      const response = await post('/v1/worker/jobs/claim', {});

      switch (response.status) {
        case 200:
          return { kind: 'claimed', ...parse(claimJobResponseSchema, await readJson(response)) };

        case 204:
          await discard(response);

          return { kind: 'idle' };

        default:
          await discard(response);

          throw new JobLeaseClientError(`gateway_${response.status}`);
      }
    },

    async renew({ jobId, leaseId }) {
      const response = await post(`/v1/worker/jobs/${jobId}/lease`, { leaseId });

      if (response.status === 200) {
        const { expiresAt } = parse(renewJobLeaseResponseSchema, await readJson(response));

        return { expiresAt, kind: 'renewed' };
      }

      if (await isLeaseStale(response)) return { kind: 'stale' };

      await discard(response);

      throw new JobLeaseClientError(`gateway_${response.status}`);
    },

    async fail({ jobId, leaseId }) {
      const response = await post(`/v1/worker/jobs/${jobId}/fail`, { leaseId });

      if (response.status === 204) {
        await discard(response);

        return { kind: 'failed' };
      }

      if (await isLeaseStale(response)) return { kind: 'stale' };

      await discard(response);

      throw new JobLeaseClientError(`gateway_${response.status}`);
    },
  };
};
