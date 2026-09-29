-- processing job은 lease 하나를 가진다. lease가 끝나면 다른 Worker가 다시 claim한다.
-- 기한 판정은 DB clock(now())만 사용한다. Worker·Gateway 시계는 믿지 않는다.
alter table public.jobs
  add column lease_id uuid,
  add column lease_expires_at timestamptz,
  add constraint jobs_lease_only_while_processing check (
    (status = 'processing' and lease_id is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_id is null and lease_expires_at is null)
  );

-- queued job이나 lease가 끝난 processing job 하나를 새 lease로 가져간다.
-- 다른 transaction이 잠근 row는 skip locked로 건너뛰어 두 Worker가 같은 job을 받지 않는다.
create function public.claim_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
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
    lease_expires_at = now() + interval '5 minutes'
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

-- 기한 전에 같은 lease_id로만 연장한다. 이미 끝났거나 다른 Worker가 가져간 lease는 stale이다.
-- 없는 job도 stale로 답해 lease_id 없이 job 존재 여부를 알 수 없게 한다.
create function public.renew_job_lease_v1(p_job_id uuid, p_lease_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
begin
  -- 동시 claim이 row를 바꿨다면 update가 commit을 기다린 뒤 새 lease_id로 조건을 다시 본다.
  update public.jobs
  set lease_expires_at = now() + interval '5 minutes'
  where id = p_job_id
    and status = 'processing'
    and lease_id = p_lease_id
    and lease_expires_at > now()
  returning lease_expires_at into v_expires_at;

  if not found then
    return jsonb_build_object('kind', 'stale');
  end if;

  return jsonb_build_object('kind', 'renewed', 'expires_at', v_expires_at);
end;
$$;

revoke all on function public.claim_job_v1() from public, anon, authenticated, service_role;
grant execute on function public.claim_job_v1() to service_role;

revoke all on function public.renew_job_lease_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_job_lease_v1(uuid, uuid) to service_role;
