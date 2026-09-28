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
  unique (owner_id, idempotency_key)
);

-- policy를 두지 않는다. 클라이언트 role은 접근할 수 없고 Gateway의 service_role만 RLS를 우회한다.
alter table public.jobs enable row level security;

-- Supabase 기본 권한은 새 table에 anon·authenticated·service_role 전부를 grant하므로 먼저 모두 걷어낸다.
revoke all on table public.jobs from public, anon, authenticated, service_role;
grant select, insert on table public.jobs to service_role;

-- 같은 owner·key 재요청은 기존 row를 돌려준다. payload 4열이 다르면 job 없이 conflict만 알린다.
create function public.create_job_v1(
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
      raise exception 'create_job_v1 row missing';
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

revoke all on function public.create_job_v1(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_job_v1(uuid, uuid, uuid, bigint, text, text) to service_role;
