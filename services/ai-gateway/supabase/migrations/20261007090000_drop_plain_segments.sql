-- 봉투 암호화 축소 단계: 평문 열을 지우고 complete_job을 암호문 전용으로 되돌린다.
-- 옛 Gateway가 모두 사라지고 감싸기 스크립트가 「남은 평문 0」을 보고한 뒤에만 적용한다.

-- 평문 행이 남아 있으면 여기서 멈춘다. 파일 전체가 한 transaction이라 아무것도 바뀌지 않는다.
do $$
begin
  if exists (select 1 from public.transcripts where segments is not null) then
    raise exception 'plain transcripts remain';
  end if;
end
$$;

-- segments 열을 지우면 그 열을 참조하는 transcripts_plain_xor_sealed도 함께 사라진다.
alter table public.transcripts drop column segments;

-- 안전장치와 drop 사이에 평문이 끼어들었다면 여기서 실패해 전체가 되돌아간다.
alter table public.transcripts
  alter column segments_sealed set not null,
  alter column dek_sealed set not null,
  alter column key_version set not null;

drop function public.complete_job(uuid, uuid, integer, jsonb, text, text, integer);

create function public.complete_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_duration_ms integer,
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

  insert into public.transcripts (job_id, owner_id, duration_ms, segments_sealed, dek_sealed, key_version)
  values (p_job_id, v_owner_id, p_duration_ms, p_segments_sealed, p_dek_sealed, p_key_version);

  return jsonb_build_object('kind', 'completed');
end;
$$;

revoke all on function public.complete_job(uuid, uuid, integer, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_job(uuid, uuid, integer, text, text, integer) to service_role;

drop function public.seal_transcript(uuid, text, text, integer);
