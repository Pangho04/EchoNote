-- Worker가 final 파일을 확정했다는 통지로 job을 created에서 queued로 옮긴다.
-- service_role에는 jobs UPDATE 권한을 주지 않는다. status 전이는 이 함수만 한다.
-- security definer로 jobs 소유자 권한을 빌리므로 search_path를 비우고 모든 이름을 schema로 한정한다.
create function public.complete_upload_v1(
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

revoke all on function public.complete_upload_v1(uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_upload_v1(uuid, uuid, bigint, text, text) to service_role;
