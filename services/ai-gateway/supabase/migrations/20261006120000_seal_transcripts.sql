-- 전사문을 Gateway가 봉투 암호화해 저장한다. 확장 단계: 평문 열(segments)과 암호문 열이 공존하고
-- complete_job은 옛 Gateway의 평문 호출과 새 Gateway의 암호문 호출을 둘 다 받는다.
-- 축소는 다음 migration에서 한다. 옛 Gateway가 사라진 뒤에만 적용한다.

alter table public.transcripts
  add column segments_sealed text,
  add column dek_sealed text,
  add column key_version integer,
  alter column segments drop not null;

-- 행은 평문 또는 암호문 정확히 한쪽만 가진다.
alter table public.transcripts
  add constraint transcripts_plain_xor_sealed check (
    (segments is not null and segments_sealed is null and dek_sealed is null and key_version is null)
    or (segments is null and segments_sealed is not null and dek_sealed is not null and key_version is not null)
  ),
  -- KEK 회전 전까지 버전은 1 하나다.
  add constraint transcripts_key_version check (key_version is null or key_version = 1),
  -- DEK 32바이트 + iv 12 + tag 16 = 60바이트는 base64로 padding 없는 80자다.
  add constraint transcripts_dek_sealed_format check (
    dek_sealed is null or dek_sealed ~ '^[A-Za-z0-9+/]{80}$'
  ),
  add constraint transcripts_segments_sealed_format check (
    segments_sealed is null or segments_sealed ~ '^[A-Za-z0-9+/]+={0,2}$'
  );

-- 매개변수 목록이 바뀌므로 지우고 다시 만든다. 새 매개변수는 default가 있어 옛 호출 모양도 그대로 맞는다.
drop function public.complete_job(uuid, uuid, integer, jsonb);

create function public.complete_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_duration_ms integer,
  p_segments jsonb default null,
  p_segments_sealed text default null,
  p_dek_sealed text default null,
  p_key_version integer default null
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

  insert into public.transcripts (job_id, owner_id, duration_ms, segments, segments_sealed, dek_sealed, key_version)
  values (p_job_id, v_owner_id, p_duration_ms, p_segments, p_segments_sealed, p_dek_sealed, p_key_version);

  return jsonb_build_object('kind', 'completed');
end;
$$;

revoke all on function public.complete_job(uuid, uuid, integer, jsonb, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_job(uuid, uuid, integer, jsonb, text, text, integer)
  to service_role;

-- 기존 평문 행을 암호문으로 바꾸는 1회용 함수. 감싸기 스크립트만 호출하고 축소 migration에서 지운다.
create function public.seal_transcript(
  p_job_id uuid,
  p_segments_sealed text,
  p_dek_sealed text,
  p_key_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.transcripts
  set segments = null,
    segments_sealed = p_segments_sealed,
    dek_sealed = p_dek_sealed,
    key_version = p_key_version
  where job_id = p_job_id
    and segments is not null;

  if not found then
    return jsonb_build_object('kind', 'not_found');
  end if;

  return jsonb_build_object('kind', 'sealed');
end;
$$;

revoke all on function public.seal_transcript(uuid, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.seal_transcript(uuid, text, text, integer) to service_role;
