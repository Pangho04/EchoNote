-- job 하나의 전사 결과. segments 형태 규칙은 Gateway가 Zod 계약으로 검사하고 DB는 배열인지만 본다.
create table public.transcripts (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  duration_ms integer not null check (duration_ms >= 0),
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now()
);

-- jobs와 같다. policy 없이 클라이언트 role을 막고 Gateway의 service_role만 읽는다. 쓰기는 complete_job_v1만 한다.
alter table public.transcripts enable row level security;

revoke all on table public.transcripts from public, anon, authenticated, service_role;
grant select on table public.transcripts to service_role;

-- lease를 가진 Worker가 전사 결과를 저장하고 job을 completed로 확정한다. 둘은 한 transaction이다.
-- stale 판정은 fail_job_v1과 같다. insert가 실패하면 update도 되돌아가 job은 processing으로 남는다.
create function public.complete_job_v1(
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

revoke all on function public.complete_job_v1(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_job_v1(uuid, uuid, integer, jsonb) to service_role;
