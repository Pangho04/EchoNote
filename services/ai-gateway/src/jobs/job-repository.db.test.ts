import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HEADER_SAFE_PATTERN, LOOPBACK_HOSTS } from '../config/environment.js';
import { createJobRepository } from './job-repository.js';

type LocalSupabase = { apiUrl: string; secretKey: string };

// 원격 프로젝트에 요청하지 않도록 첫 fetch 전에 loopback API URL인지 확인한다.
const readLocalSupabase = (): LocalSupabase | undefined => {
  try {
    const output = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const env = new Map(
      output
        .split('\n')
        .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
        .filter((match) => match !== null)
        .map(([, name, value]) => [name, value!.replace(/^"(.*)"$/, '$1')]),
    );
    const apiUrl = new URL(env.get('API_URL') ?? '');
    const secretKey = env.get('SECRET_KEY') ?? '';

    if (!HEADER_SAFE_PATTERN.test(secretKey) || !LOOPBACK_HOSTS.has(apiUrl.hostname)) {
      return undefined;
    }

    return { apiUrl: apiUrl.origin, secretKey };
  } catch {
    return undefined;
  }
};

let local: LocalSupabase;
const userIds: string[] = [];

// 실패 문구에 응답 body·헤더를 담지 않는다.
const callLocal = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${local.apiUrl}${path}`, {
    ...init,
    headers: { apikey: local.secretKey, 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} http_${response.status}`);
  }

  return response;
};

const createUser = async () => {
  const response = await callLocal('/auth/v1/admin/users', {
    body: JSON.stringify({ email: `${randomUUID()}@example.test`, email_confirm: true }),
    method: 'POST',
  });
  const { id } = (await response.json()) as { id: string };

  userIds.push(id);

  return id;
};

const createInput = (ownerId: string, idempotencyKey: string) => ({
  idempotencyKey,
  meetingId: '00000000-0000-4000-8000-00000000000c',
  mimeType: 'audio/mp4' as const,
  ownerId,
  sha256: 'a'.repeat(64),
  sizeBytes: 100,
});

beforeAll(() => {
  const found = readLocalSupabase();

  if (found === undefined) {
    throw new Error(
      'local supabase unavailable (from repo root: pnpm supabase:start && pnpm exec supabase migration up --local --workdir services/ai-gateway)',
    );
  }

  local = found;
});

afterAll(async () => {
  // jobs는 auth.users on delete cascade로 함께 지워진다.
  await Promise.all(
    userIds.map(async (id) => callLocal(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })),
  );
});

describe('createJobRepository (local Supabase)', () => {
  it('같은 owner·key 동시 요청 10건은 row 1개로 수렴한다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const ownerId = await createUser();
    const idempotencyKey = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 10 }, async () =>
        repository.createJob(createInput(ownerId, idempotencyKey)),
      ),
    );
    const rows = (await (
      await callLocal(
        `/rest/v1/jobs?select=id&owner_id=eq.${ownerId}&idempotency_key=eq.${idempotencyKey}`,
      )
    ).json()) as { id: string }[];
    const ids = new Set(results.map((result) => ('job' in result ? result.job.id : undefined)));

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'existing')).toHaveLength(9);
    expect(ids).toEqual(new Set([rows[0]?.id]));
    expect(rows).toHaveLength(1);
  });

  it('다른 owner는 같은 key·payload로도 각자 row를 만든다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
    const idempotencyKey = randomUUID();

    const resultA = await repository.createJob(createInput(ownerA, idempotencyKey));
    const resultB = await repository.createJob(createInput(ownerB, idempotencyKey));

    expect(resultA.kind).toBe('created');
    expect(resultB.kind).toBe('created');
    expect('job' in resultA && 'job' in resultB && resultA.job.id !== resultB.job.id).toBe(true);
  });
});

describe('findOwnedJob (local Supabase)', () => {
  it('owner의 job만 찾고 다른 owner에게는 null을 돌려준다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
    const created = await repository.createJob(createInput(ownerA, randomUUID()));

    if (created.kind !== 'created') throw new Error('job was not created');

    const owned = await repository.findOwnedJob({ jobId: created.job.id, ownerId: ownerA });
    const foreign = await repository.findOwnedJob({ jobId: created.job.id, ownerId: ownerB });

    expect(owned).toEqual(created.job);
    expect(foreign).toBeNull();
  });
});

describe('completeUpload (local Supabase)', () => {
  it('같은 통지 동시 10건은 queued 1건·existing 9건이고 status는 queued다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const ownerId = await createUser();
    const created = await repository.createJob(createInput(ownerId, randomUUID()));

    if (created.kind !== 'created') throw new Error('job was not created');

    const completion = {
      jobId: created.job.id,
      mimeType: created.job.mimeType,
      ownerId,
      sha256: created.job.sha256,
      sizeBytes: created.job.sizeBytes,
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, async () => repository.completeUpload(completion)),
    );

    expect(results.filter((result) => result.kind === 'queued')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'existing')).toHaveLength(9);
    expect(await repository.findOwnedJob({ jobId: created.job.id, ownerId })).toMatchObject({
      status: 'queued',
    });
  });

  it('payload가 다르면 conflict, 다른 owner면 not_found이고 status는 created다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const [ownerA, ownerB] = await Promise.all([createUser(), createUser()]);
    const created = await repository.createJob(createInput(ownerA, randomUUID()));

    if (created.kind !== 'created') throw new Error('job was not created');

    const completion = {
      jobId: created.job.id,
      mimeType: created.job.mimeType,
      ownerId: ownerA,
      sha256: created.job.sha256,
      sizeBytes: created.job.sizeBytes,
    };

    await expect(
      repository.completeUpload({ ...completion, sha256: 'b'.repeat(64) }),
    ).resolves.toEqual({ kind: 'conflict' });
    await expect(repository.completeUpload({ ...completion, ownerId: ownerB })).resolves.toEqual({
      kind: 'not_found',
    });
    expect(await repository.findOwnedJob({ jobId: created.job.id, ownerId: ownerA })).toEqual(
      created.job,
    );
  });
});

describe('claimJob·renewJobLease·failJob (local Supabase)', () => {
  it('queued job 둘에 동시 claim 10건은 두 job을 한 번씩만 가져가고 그 lease로만 연장·실패 확정된다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const ownerId = await createUser();
    const jobs = [];

    for (const idempotencyKey of [randomUUID(), randomUUID()]) {
      const created = await repository.createJob(createInput(ownerId, idempotencyKey));

      if (created.kind !== 'created') throw new Error('job was not created');

      jobs.push(created.job);
    }

    // claim은 모든 owner의 job을 본다. 이 파일의 앞선 테스트나 이전 실행이 남긴 claim 가능한 job을 먼저 비운다.
    while ((await repository.claimJob()).kind === 'claimed');

    for (const job of jobs) {
      await repository.completeUpload({
        jobId: job.id,
        mimeType: job.mimeType,
        ownerId,
        sha256: job.sha256,
        sizeBytes: job.sizeBytes,
      });
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, async () => repository.claimJob()),
    );
    const claimed = results.filter((result) => result.kind === 'claimed');
    const claimedIds = claimed.map((result) => result.job.id);

    // 비운 뒤 lease가 막 끝난 이전 실행의 job이 함께 claim될 수 있어 만든 두 job의 포함만 단언한다.
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds).toEqual(expect.arrayContaining(jobs.map((job) => job.id)));

    const firstJobId = jobs[0]!.id;
    const first = claimed.find((result) => result.job.id === firstJobId);

    if (first === undefined) throw new Error('created job was not claimed');

    const renewed = await repository.renewJobLease({
      jobId: first.job.id,
      leaseId: first.lease.leaseId,
    });

    if (renewed.kind !== 'renewed') throw new Error('lease was not renewed');

    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(first.lease.expiresAt));
    await expect(
      repository.renewJobLease({ jobId: first.job.id, leaseId: randomUUID() }),
    ).resolves.toEqual({ kind: 'stale' });
    await expect(
      repository.failJob({ jobId: first.job.id, leaseId: randomUUID() }),
    ).resolves.toEqual({ kind: 'stale' });

    const lease = { jobId: first.job.id, leaseId: first.lease.leaseId };

    await expect(repository.failJob(lease)).resolves.toEqual({ kind: 'failed' });
    // failed가 되면 lease가 사라져 같은 lease로도 연장·재확정할 수 없다.
    await expect(repository.renewJobLease(lease)).resolves.toEqual({ kind: 'stale' });
    await expect(repository.failJob(lease)).resolves.toEqual({ kind: 'stale' });
  });
});

describe('completeJob·findOwnedTranscript (local Supabase)', () => {
  it('lease로 약 3.5 MiB 전사 결과를 저장하고 owner에게만 돌려준다', async () => {
    const repository = createJobRepository({
      secretKey: local.secretKey,
      supabaseUrl: local.apiUrl,
      timeoutMs: 5000,
    });
    const ownerId = await createUser();
    const otherOwnerId = await createUser();
    const created = await repository.createJob(createInput(ownerId, randomUUID()));

    if (created.kind !== 'created') throw new Error('job was not created');

    const { job } = created;

    while ((await repository.claimJob()).kind === 'claimed');

    await repository.completeUpload({
      jobId: job.id,
      mimeType: job.mimeType,
      ownerId,
      sha256: job.sha256,
      sizeBytes: job.sizeBytes,
    });

    // 비운 뒤 lease가 막 끝난 이전 실행의 job이 먼저 claim될 수 있다.
    let leaseId: string | undefined;

    for (let attempt = 0; attempt < 10 && leaseId === undefined; attempt += 1) {
      const result = await repository.claimJob();

      if (result.kind === 'idle') break;

      if (result.job.id === job.id) leaseId = result.lease.leaseId;
    }

    if (leaseId === undefined) throw new Error('created job was not claimed');

    const transcript = {
      durationMs: 20_000,
      segments: Array.from({ length: 20_000 }, (_, index) => ({
        endMs: index + 1,
        startMs: index,
        text: `${index} ${'가'.repeat(45)}😀`,
      })),
    };

    expect(Buffer.byteLength(JSON.stringify(transcript))).toBeGreaterThan(3.4 * 1024 * 1024);
    await expect(repository.findOwnedTranscript({ jobId: job.id, ownerId })).resolves.toBeNull();
    await expect(
      repository.completeJob({ jobId: job.id, leaseId: randomUUID(), transcript }),
    ).resolves.toEqual({ kind: 'stale' });
    await expect(repository.completeJob({ jobId: job.id, leaseId, transcript })).resolves.toEqual({
      kind: 'completed',
    });
    await expect(repository.findOwnedTranscript({ jobId: job.id, ownerId })).resolves.toEqual(
      transcript,
    );
    await expect(
      repository.findOwnedTranscript({ jobId: job.id, ownerId: otherOwnerId }),
    ).resolves.toBeNull();
    // completed가 되면 lease가 사라져 같은 lease로도 다시 확정·실패할 수 없다.
    await expect(repository.completeJob({ jobId: job.id, leaseId, transcript })).resolves.toEqual({
      kind: 'stale',
    });
    await expect(repository.failJob({ jobId: job.id, leaseId })).resolves.toEqual({
      kind: 'stale',
    });
  });
});
