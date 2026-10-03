-- 사용자마다 대기 job을 번갈아 가져간다. 한 사용자가 여러 job을 먼저 올려도 다른 사용자가 그 뒤에 다 밀리지 않는다.
-- 반환 모양은 그대로라 같은 이름으로 교체한다.

-- 마지막으로 claim된 시각. 사용자별로 가장 오래 처리받지 못한 쪽을 고르는 데 쓴다.
alter table public.jobs add column claimed_at timestamptz;

create or replace function public.claim_job()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  -- 3번 잡혔는데도 lease가 끝난 job은 다시 잡지 않고 attempts_exhausted로 failed 확정한다.
  -- Worker가 직접 보고한 실패는 fail_job이 바로 failed로 만들므로 이 상한과 무관하다.
  update public.jobs
  set status = 'failed',
    error_code = 'attempts_exhausted',
    lease_id = null,
    lease_expires_at = null
  where status = 'processing'
    and lease_expires_at <= now()
    and attempt_count >= 3;

  -- 멈춘 Worker의 job을 먼저 되찾는다. 그다음 가장 오래 처리받지 못한 사용자(처음이면 맨 앞)의 오래된 job을 고른다.
  select j.* into v_job
  from public.jobs j
  where j.status = 'queued' or (j.status = 'processing' and j.lease_expires_at <= now())
  order by (j.status = 'processing') desc,
    (select max(o.claimed_at) from public.jobs o where o.owner_id = j.owner_id) nulls first,
    j.created_at,
    j.id
  limit 1
  for update of j skip locked;

  if not found then
    return jsonb_build_object('kind', 'idle');
  end if;

  update public.jobs
  set status = 'processing',
    lease_id = gen_random_uuid(),
    lease_expires_at = now() + interval '5 minutes',
    attempt_count = attempt_count + 1,
    claimed_at = now()
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
