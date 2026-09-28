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
    throw new Error('local supabase unavailable (run pnpm supabase:start && pnpm supabase:reset)');
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
