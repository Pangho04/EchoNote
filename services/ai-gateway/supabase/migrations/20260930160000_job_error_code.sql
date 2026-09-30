-- failed job이 왜 실패했는지 남긴다. 값 목록은 contracts jobFailureCodeSchema와 같다.
alter table public.jobs
  add column error_code text
    constraint jobs_error_code_known check (error_code in (
      'audio_missing',
      'stt_unavailable',
      'stt_failed',
      'result_rejected',
      'attempts_exhausted',
      'unexpected'
    )),
  add constraint jobs_error_code_only_when_failed check (error_code is null or status = 'failed');

-- 실패 이유를 함께 받는 fail_job_v2로 바꾼다. Gateway와 이 migration은 같은 배포에 올라간다.
drop function public.fail_job_v1(uuid, uuid);

-- 처리 중 오류가 난 job을 failed로 확정하고 이유를 남긴다. lease를 가진 Worker만 확정할 수 있다.
-- stale 판정과 없는 job을 stale로 숨기는 규칙은 fail_job_v1과 같다.
-- 목록 밖 p_error_code는 jobs_error_code_known이 거부해 아무것도 바꾸지 않는다.
create function public.fail_job_v2(p_job_id uuid, p_lease_id uuid, p_error_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'failed',
    error_code = p_error_code,
    lease_id = null,
    lease_expires_at = null
  where id = p_job_id
    and status = 'processing'
    and lease_id = p_lease_id
    and lease_expires_at > now();

  if not found then
    return jsonb_build_object('kind', 'stale');
  end if;

  return jsonb_build_object('kind', 'failed');
end;
$$;

revoke all on function public.fail_job_v2(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.fail_job_v2(uuid, uuid, text) to service_role;

-- 3번 잡혔는데도 lease가 끝난 job은 attempts_exhausted로 failed 확정한다. 나머지는 20260930150000과 같다.
create or replace function public.claim_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  update public.jobs
  set status = 'failed',
    error_code = 'attempts_exhausted',
    lease_id = null,
    lease_expires_at = null
  where status = 'processing'
    and lease_expires_at <= now()
    and attempt_count >= 3;

  -- 멈춘 Worker의 job을 먼저 되찾고, 그다음 오래된 순서로 고른다.
  select * into v_job
  from public.jobs
  where status = 'queued' or (status = 'processing' and lease_expires_at <= now())
  order by (status = 'processing') desc, created_at, id
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('kind', 'idle');
  end if;

  update public.jobs
  set status = 'processing',
    lease_id = gen_random_uuid(),
    lease_expires_at = now() + interval '5 minutes',
    attempt_count = attempt_count + 1
  where id = v_job.id
  returning * into v_job;

  return jsonb_build_object(
    'kind', 'claimed',
    'job', jsonb_build_object(
      'id', v_job.id,
      'meeting_id', v_job.meeting_id,
      'status', v_job.status,
      'size_bytes', v_job.size_bytes,
      'sha256', v_job.sha256,
      'mime_type', v_job.mime_type,
      'created_at', v_job.created_at
    ),
    'lease', jsonb_build_object(
      'lease_id', v_job.lease_id,
      'expires_at', v_job.lease_expires_at
    )
  );
end;
$$;

revoke all on function public.claim_job_v1() from public, anon, authenticated, service_role;
grant execute on function public.claim_job_v1() to service_role;
