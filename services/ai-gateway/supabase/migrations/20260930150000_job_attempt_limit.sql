-- claim될 때마다 1씩 오른다. Worker가 말없이 사라져 lease가 끝난 job을 몇 번 다시 잡았는지 센다.
alter table public.jobs
  add column attempt_count integer not null default 0 check (attempt_count >= 0);

-- 3번 잡혔는데도 lease가 끝난 job은 다시 잡지 않고 failed로 확정한다.
-- Worker가 직접 보고한 실패는 fail_job_v1이 바로 failed로 만들므로 이 상한과 무관하다.
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
