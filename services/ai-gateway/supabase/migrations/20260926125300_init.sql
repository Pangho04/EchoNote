-- 기한 판정은 DB clock(now())만 사용한다. Worker·Gateway 시계는 믿지 않는다.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null,
  size_bytes bigint not null check (size_bytes between 1 and 536870912),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('audio/mp4')),
  status text not null default 'created'
    check (status in ('created', 'queued', 'processing', 'completed', 'failed')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  -- processing job은 lease 하나를 가진다. lease가 끝나면 다른 Worker가 다시 claim한다.
  lease_id uuid,
  lease_expires_at timestamptz,
  -- claim될 때마다 1씩 오른다. Worker가 말없이 사라져 lease가 끝난 job을 몇 번 다시 잡았는지 센다.
  attempt_count integer not null default 0 check (attempt_count >= 0),
  -- failed job이 왜 실패했는지 남긴다. 값 목록은 contracts jobFailureCodeSchema와 같다.
  error_code text
    constraint jobs_error_code_known check (error_code in (
      'audio_missing',
      'stt_unavailable',
      'stt_failed',
      'result_rejected',
      'attempts_exhausted',
      'unexpected'
    )),
  unique (owner_id, idempotency_key),
  constraint jobs_lease_only_while_processing check (
    (status = 'processing' and lease_id is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_id is null and lease_expires_at is null)
  ),
  constraint jobs_error_code_only_when_failed check (error_code is null or status = 'failed')
);

-- policy를 두지 않는다. 클라이언트 role은 접근할 수 없고 Gateway의 service_role만 RLS를 우회한다.
alter table public.jobs enable row level security;

-- Supabase 기본 권한은 새 table에 anon·authenticated·service_role 전부를 grant하므로 먼저 모두 걷어낸다.
-- service_role에는 UPDATE 권한을 주지 않는다. status 전이는 아래 함수만 한다.
revoke all on table public.jobs from public, anon, authenticated, service_role;
grant select, insert on table public.jobs to service_role;

-- job 하나의 전사 결과. segments 형태 규칙은 Gateway가 Zod 계약으로 검사하고 DB는 배열인지만 본다.
create table public.transcripts (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  duration_ms integer not null check (duration_ms >= 0),
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now()
);

-- jobs와 같다. policy 없이 클라이언트 role을 막고 Gateway의 service_role만 읽는다. 쓰기는 complete_job만 한다.
alter table public.transcripts enable row level security;

revoke all on table public.transcripts from public, anon, authenticated, service_role;
grant select on table public.transcripts to service_role;

-- 아래 security definer 함수는 jobs 소유자 권한을 빌리므로 search_path를 비우고 모든 이름을 schema로 한정한다.

-- 같은 owner·key 재요청은 기존 row를 돌려준다. payload 4열이 다르면 job 없이 conflict만 알린다.
create function public.create_job(
  p_owner_id uuid,
  p_idempotency_key uuid,
  p_meeting_id uuid,
  p_size_bytes bigint,
  p_sha256 text,
  p_mime_type text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_kind text := 'created';
begin
  insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
  values (p_owner_id, p_idempotency_key, p_meeting_id, p_size_bytes, p_sha256, p_mime_type)
  on conflict (owner_id, idempotency_key) do nothing
  returning * into v_job;

  if not found then
    -- 동시 삽입이 있었다면 on conflict가 그 transaction의 commit까지 기다린다.
    -- READ COMMITTED(PostgREST 기본)에서는 문장마다 새 snapshot을 잡으므로 이 select는 row를 본다.
    select * into v_job
    from public.jobs
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;

    if not found then
      raise exception 'create_job row missing';
    end if;

    if (v_job.meeting_id, v_job.size_bytes, v_job.sha256, v_job.mime_type)
      is distinct from (p_meeting_id, p_size_bytes, p_sha256, p_mime_type) then
      return jsonb_build_object('kind', 'conflict');
    end if;

    v_kind := 'existing';
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'job', jsonb_build_object(
      'id', v_job.id,
      'meeting_id', v_job.meeting_id,
      'status', v_job.status,
      'size_bytes', v_job.size_bytes,
      'sha256', v_job.sha256,
      'mime_type', v_job.mime_type,
      'created_at', v_job.created_at
    )
  );
end;
$$;

-- Worker가 final 파일을 확정했다는 통지로 job을 created에서 queued로 옮긴다.
create function public.complete_upload(
  p_job_id uuid,
  p_owner_id uuid,
  p_size_bytes bigint,
  p_sha256 text,
  p_mime_type text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_kind text := 'existing';
begin
  -- 같은 job의 동시 통지는 row lock에서 줄을 선다. 먼저 commit한 쪽만 created를 본다.
  select * into v_job
  from public.jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  -- 다른 owner의 job은 없는 job과 구분하지 않는다.
  if not found then
    return jsonb_build_object('kind', 'not_found');
  end if;

  if (v_job.size_bytes, v_job.sha256, v_job.mime_type)
    is distinct from (p_size_bytes, p_sha256, p_mime_type) then
    return jsonb_build_object('kind', 'conflict');
  end if;

  if v_job.status = 'created' then
    update public.jobs set status = 'queued' where id = v_job.id
    returning * into v_job;

    v_kind := 'queued';
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'job', jsonb_build_object(
      'id', v_job.id,
      'meeting_id', v_job.meeting_id,
      'status', v_job.status,
      'size_bytes', v_job.size_bytes,
      'sha256', v_job.sha256,
      'mime_type', v_job.mime_type,
      'created_at', v_job.created_at
    )
  );
end;
$$;

-- queued job이나 lease가 끝난 processing job 하나를 새 lease로 가져간다.
-- 다른 transaction이 잠근 row는 skip locked로 건너뛰어 두 Worker가 같은 job을 받지 않는다.
create function public.claim_job()
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

-- 기한 전에 같은 lease_id로만 연장한다. 이미 끝났거나 다른 Worker가 가져간 lease는 stale이다.
-- 없는 job도 stale로 답해 lease_id 없이 job 존재 여부를 알 수 없게 한다. fail_job·complete_job도 같다.
create function public.renew_job_lease(p_job_id uuid, p_lease_id uuid)
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

-- 처리 중 오류가 난 job을 failed로 확정하고 이유를 남긴다. lease를 가진 Worker만 확정할 수 있다.
-- 목록 밖 p_error_code는 jobs_error_code_known이 거부해 아무것도 바꾸지 않는다.
create function public.fail_job(p_job_id uuid, p_lease_id uuid, p_error_code text)
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

-- lease를 가진 Worker가 전사 결과를 저장하고 job을 completed로 확정한다. 둘은 한 transaction이다.
-- insert가 실패하면 update도 되돌아가 job은 processing으로 남는다.
create function public.complete_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_duration_ms integer,
  p_segments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  update public.jobs
  set status = 'completed',
    lease_id = null,
    lease_expires_at = null
  where id = p_job_id
    and status = 'processing'
    and lease_id = p_lease_id
    and lease_expires_at > now()
  returning owner_id into v_owner_id;

  if not found then
    return jsonb_build_object('kind', 'stale');
  end if;

  insert into public.transcripts (job_id, owner_id, duration_ms, segments)
  values (p_job_id, v_owner_id, p_duration_ms, p_segments);

  return jsonb_build_object('kind', 'completed');
end;
$$;

revoke all on function public.create_job(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_job(uuid, uuid, uuid, bigint, text, text) to service_role;

revoke all on function public.complete_upload(uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_upload(uuid, uuid, bigint, text, text) to service_role;

revoke all on function public.claim_job() from public, anon, authenticated, service_role;
grant execute on function public.claim_job() to service_role;

revoke all on function public.renew_job_lease(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_job_lease(uuid, uuid) to service_role;

revoke all on function public.fail_job(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_job(uuid, uuid, text) to service_role;

revoke all on function public.complete_job(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_job(uuid, uuid, integer, jsonb) to service_role;
