-- 처리 중 오류가 난 job을 failed로 확정한다. lease를 가진 Worker만 확정할 수 있다.
-- 기한이 지났거나 다른 Worker가 가져간 lease는 stale이고 아무것도 바꾸지 않는다.
-- 없는 job도 stale로 답해 lease_id 없이 job 존재 여부를 알 수 없게 한다.
create function public.fail_job_v1(p_job_id uuid, p_lease_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'failed',
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

revoke all on function public.fail_job_v1(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.fail_job_v1(uuid, uuid) to service_role;
