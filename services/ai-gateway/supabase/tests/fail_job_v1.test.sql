begin;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test');

-- transaction 안에서 now()는 고정이다. 기한은 now() 기준 상대값으로 만든다.
delete from public.jobs;

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at, lease_id, lease_expires_at)
values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '2 hours', '00000000-0000-4000-8000-0000000001b1', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '1 hour', '00000000-0000-4000-8000-0000000001b2', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '3 hours', '00000000-0000-4000-8000-0000000001e1', now() - interval '1 second');

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'queued');

-- 구조
select is(
  (select prosecdef from pg_proc where oid = 'public.fail_job_v1'::regproc),
  true,
  'fail_job_v1은 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.fail_job_v1'::regproc) @> array['search_path=""'],
  'fail_job_v1은 빈 search_path로 실행된다'
);
select is(
  (select proowner from pg_proc where oid = 'public.fail_job_v1'::regproc),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'fail_job_v1 소유자는 jobs 소유자다'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fail_job_v1'),
  1::bigint,
  'fail_job_v1 overload는 하나다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.fail_job_v1(uuid,uuid)', 'execute'),
  'anon은 fail_job_v1을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.fail_job_v1(uuid,uuid)', 'execute'),
  'authenticated는 fail_job_v1을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.fail_job_v1(uuid,uuid)', 'execute'),
  'service_role은 fail_job_v1을 실행할 수 있다'
);
select table_privs_are('public', 'jobs', 'service_role', array['SELECT', 'INSERT']);

set local role service_role;

-- 성공
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1'),
  '{"kind": "failed"}'::jsonb,
  '기한 전 같은 lease_id는 failed다'
);
select ok(
  (select status = 'failed' and lease_id is null and lease_expires_at is null
   from public.jobs where id = '00000000-0000-4000-8000-0000000000b1'),
  'failed job은 lease 두 열을 비운다'
);
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1'),
  '{"kind": "stale"}'::jsonb,
  '이미 failed인 job에 같은 lease_id로 다시 보내면 stale이다'
);

-- stale
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000b2', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  '다른 lease_id는 stale이다'
);
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000001e1'),
  '{"kind": "stale"}'::jsonb,
  '기한 지난 lease는 같은 lease_id라도 stale이다'
);
-- jobs_lease_only_while_processing 때문에 processing이 아닌 job은 lease가 없다.
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000a1', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  'lease가 없는 queued job은 stale이다'
);
select is(
  public.fail_job_v1('00000000-0000-4000-8000-0000000000f9', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  '없는 job은 stale이다'
);
select ok(
  (select status = 'processing' and lease_id = '00000000-0000-4000-8000-0000000001b2'
   from public.jobs where id = '00000000-0000-4000-8000-0000000000b2'),
  'stale fail은 job을 바꾸지 않는다'
);

-- failed job은 다시 claim되지 않는다. b2(기한 남음)도 대상이 아니다.
select is(
  array[public.claim_job_v1() -> 'job' ->> 'id', public.claim_job_v1() -> 'job' ->> 'id',
    public.claim_job_v1() ->> 'kind'],
  array['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'idle'],
  'failed job은 claim 대상이 아니다'
);

-- authenticated 호출 거부
set local role authenticated;

select is(current_user::text, 'authenticated', 'authenticated로 실행 중이다');
select throws_ok(
  $$select public.fail_job_v1(gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'authenticated는 fail_job_v1을 호출할 수 없다'
);

reset role;

select * from finish();

rollback;
