// 1회용: 평문으로 남은 transcripts 행을 Gateway와 같은 cipher로 잠근다. 축소 migration과 함께 지운다.
// 실행: pnpm seal:transcripts:local | pnpm seal:transcripts:remote --yes-remote
// 출력은 건수와 reason 코드만. URL·호스트·평문·키는 출력하지 않는다.
import { transcriptResultSchema } from '@echonote/contracts';
import { z } from 'zod';

import { HEADER_SAFE_PATTERN, loadTranscriptKek, LOOPBACK_HOSTS } from '../config/environment.js';
import { createTranscriptCipher, TranscriptCipherError } from '../jobs/transcript-cipher.js';

const PAGE_SIZE = 100;

let sealedCount = 0;
let skippedCount = 0;

const fail = (reason: string): never => {
  console.error(
    `seal-existing-transcripts: ${reason} (잠금 ${sealedCount} / 건너뜀 ${skippedCount})`,
  );
  process.exit(1);
};

const targets = process.argv.filter((arg) => arg.startsWith('--target='));

if (targets.length !== 1) fail('target_arg_count');

const target = targets[0]!.slice('--target='.length);
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? '';

if (!URL.canParse(supabaseUrl) || !HEADER_SAFE_PATTERN.test(secretKey)) fail('env_missing');

const url = new URL(supabaseUrl);
const isLoopback = LOOPBACK_HOSTS.has(url.hostname);

if (target === 'local' && !isLoopback) fail('local_requires_loopback');

if (target === 'remote' && isLoopback) fail('remote_requires_non_loopback');

if (target === 'remote' && url.protocol !== 'https:') fail('remote_requires_https');

if (target === 'remote' && !process.argv.includes('--yes-remote')) fail('remote_requires_flag');

if (target !== 'local' && target !== 'remote') fail('unknown_target');

const sealedRowSchema = z.object({
  job_id: z.uuid(),
  segments_sealed: z.string(),
  dek_sealed: z.string(),
  key_version: z.number(),
});
const idRowSchema = z.object({ job_id: z.uuid() });
const plainRowSchema = z.object({ duration_ms: z.unknown(), segments: z.unknown() });
const sealResultSchema = z.object({ kind: z.enum(['sealed', 'not_found']) });

const headers = { apikey: secretKey, 'content-type': 'application/json' };

// 응답 body·오류 cause에 호스트나 평문이 들어갈 수 있어 모양만 검사하고 reason 코드로 바꾼다.
const call = async <T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}) => {
  const response = await fetch(`${url.origin}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    await response.body?.cancel();

    return fail(`http_${response.status}`);
  }

  const parsed = schema.safeParse(await response.json());

  return parsed.success ? parsed.data : fail('invalid_response');
};

const classify = (error: unknown) => {
  if (error instanceof TranscriptCipherError) return error.reason;

  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';

  if (error instanceof TypeError) return 'network';

  if (error instanceof SyntaxError) return 'invalid_json';

  return 'unexpected';
};

try {
  const cipher = createTranscriptCipher({ kek: loadTranscriptKek().kek });

  // canary: 운영 Gateway가 이미 만든 암호문을 이 KEK로 전부 열 수 있어야 같은 KEK다. 하나도 없으면 멈춘다.
  // ponytail: 한 번에 읽어 PostgREST max_rows(1000) 상한을 받는다. 개인 규모라 충분하다.
  const sealedRows = await call(
    '/rest/v1/transcripts?select=job_id,segments_sealed,dek_sealed,key_version&segments_sealed=not.is.null',
    z.array(sealedRowSchema),
  );

  if (sealedRows.length === 0) fail('canary_missing');

  for (const row of sealedRows) {
    try {
      cipher.open({
        dekSealed: row.dek_sealed,
        jobId: row.job_id,
        keyVersion: row.key_version,
        segmentsSealed: row.segments_sealed,
      });
    } catch {
      fail('canary_open_failed');
    }
  }

  // 잠근 행은 다음 조회에서 빠지므로 항상 남은 평문의 앞쪽을 다시 읽는다. 0건이면 끝.
  for (;;) {
    const ids = await call(
      `/rest/v1/transcripts?select=job_id&segments=not.is.null&order=job_id&limit=${PAGE_SIZE}`,
      z.array(idRowSchema),
    );

    if (ids.length === 0) break;

    for (const { job_id: jobId } of ids) {
      const [row] = await call(
        `/rest/v1/transcripts?select=duration_ms,segments&job_id=eq.${jobId}`,
        z.array(plainRowSchema).max(1),
      );

      // 조회와 조회 사이에 다른 실행이 먼저 잠갔을 수 있다.
      if (row === undefined || row.segments === null) {
        skippedCount += 1;
        continue;
      }

      const sealed = cipher.seal({ jobId, segments: row.segments });
      const roundTrip = transcriptResultSchema.safeParse({
        durationMs: row.duration_ms,
        segments: cipher.open({ ...sealed, jobId }),
      });

      if (!roundTrip.success) fail('round_trip_failed');

      const result = await call('/rest/v1/rpc/seal_transcript', sealResultSchema, {
        body: JSON.stringify({
          p_job_id: jobId,
          p_segments_sealed: sealed.segmentsSealed,
          p_dek_sealed: sealed.dekSealed,
          p_key_version: sealed.keyVersion,
        }),
        method: 'POST',
      });

      if (result.kind === 'sealed') sealedCount += 1;
      else skippedCount += 1;
    }
  }

  const remaining = await call(
    '/rest/v1/transcripts?select=job_id&segments=not.is.null',
    z.array(idRowSchema),
  );

  console.log(`잠금 ${sealedCount} / 건너뜀 ${skippedCount} / 남은 평문 ${remaining.length}`);

  if (remaining.length > 0) process.exitCode = 1;
} catch (error) {
  fail(classify(error));
}
