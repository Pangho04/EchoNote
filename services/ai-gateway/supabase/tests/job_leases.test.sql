begin;

select plan(40);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test');

-- transaction 안에서 now()는 고정이다. 기한은 now() 기준 상대값으로 만든다.
delete from public.jobs;

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'created',
   now() - interval '3 hours'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'queued',
   now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'queued',
   now() - interval '1 hour');

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at, lease_id, lease_expires_at)
values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now(), '00000000-0000-4000-8000-0000000001e1', now() - interval '1 second'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '4 hours', '00000000-0000-4000-8000-0000000001b1', now() + interval '1 minute');

-- 구조
select is(
  (select prosecdef from pg_proc where oid = 'public.claim_job_v1'::regproc),
  true,
  'claim_job_v1은 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.claim_job_v1'::regproc) @> array['search_path=""'],
  'claim_job_v1은 빈 search_path로 실행된다'
);
select is(
  (select proowner from pg_proc where oid = 'public.claim_job_v1'::regproc),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'claim_job_v1 소유자는 jobs 소유자다'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.renew_job_lease_v1'::regproc),
  true,
  'renew_job_lease_v1은 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.renew_job_lease_v1'::regproc) @> array['search_path=""'],
  'renew_job_lease_v1은 빈 search_path로 실행된다'
);
select is(
  (select proowner from pg_proc where oid = 'public.renew_job_lease_v1'::regproc),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'renew_job_lease_v1 소유자는 jobs 소유자다'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('claim_job_v1', 'renew_job_lease_v1')),
  2::bigint,
  'lease 함수 overload는 각각 하나다'
);

-- lease 열 제약
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 100,
      repeat('a', 64), 'audio/mp4', 'processing')$$,
  '23514', null, 'lease 없는 processing job은 넣을 수 없다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
      lease_id, lease_expires_at)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 100,
      repeat('a', 64), 'audio/mp4', 'queued', gen_random_uuid(), now())$$,
  '23514', null, 'lease 있는 queued job은 넣을 수 없다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
      lease_id)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 100,
      repeat('a', 64), 'audio/mp4', 'processing', gen_random_uuid())$$,
  '23514', null, 'lease 기한 없는 processing job은 넣을 수 없다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.claim_job_v1()', 'execute'),
  'anon은 claim_job_v1을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_job_v1()', 'execute'),
  'authenticated는 claim_job_v1을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.claim_job_v1()', 'execute'),
  'service_role은 claim_job_v1을 실행할 수 있다'
);
select ok(
  not has_function_privilege('anon', 'public.renew_job_lease_v1(uuid,uuid)', 'execute'),
  'anon은 renew_job_lease_v1을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.renew_job_lease_v1(uuid,uuid)', 'execute'),
  'authenticated는 renew_job_lease_v1을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.renew_job_lease_v1(uuid,uuid)', 'execute'),
  'service_role은 renew_job_lease_v1을 실행할 수 있다'
);
select table_privs_are('public', 'jobs', 'service_role', array['SELECT', 'INSERT']);

-- claim 순서: 기한 지난 processing → 오래된 queued. created와 기한 남은 processing은 가져가지 않는다.
create temp table claims (n int, result jsonb);
grant insert, select on claims to service_role;

set local role service_role;

insert into claims select 1, public.claim_job_v1();
insert into claims select 2, public.claim_job_v1();
insert into claims select 3, public.claim_job_v1();
insert into claims select 4, public.claim_job_v1();

select is(
  (select array_agg(result -> 'job' ->> 'id' order by n) from claims where n <= 3),
  array['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a2'],
  '기한 지난 processing을 먼저, 그다음 queued를 created_at 순으로 가져간다'
);
select is(
  (select array_agg(result ->> 'kind' order by n) from claims),
  array['claimed', 'claimed', 'claimed', 'idle'],
  '가져갈 job이 없으면 idle이다'
);
select is(
  (select array_agg(key order by key) from claims, jsonb_object_keys(result) as key where n = 4),
  array['kind'],
  'idle은 kind만 담는다'
);
select is(
  (select array_agg(key order by key) from claims, jsonb_object_keys(result -> 'job') as key where n = 2),
  array['created_at', 'id', 'meeting_id', 'mime_type', 'sha256', 'size_bytes', 'status'],
  'claimed job은 create_job_v1과 같은 7개 키를 가진다'
);
select is(
  (select array_agg(key order by key) from claims, jsonb_object_keys(result -> 'lease') as key where n = 2),
  array['expires_at', 'lease_id'],
  'claimed lease는 lease_id와 expires_at을 가진다'
);
select is(
  (select result -> 'job' ->> 'status' from claims where n = 2),
  'processing',
  'claimed job의 status는 processing이다'
);
select is(
  (select (result -> 'lease' ->> 'expires_at')::timestamptz from claims where n = 2),
  now() + interval '5 minutes',
  'lease 기한은 DB 시각 + 5분이다'
);
select ok(
  (select j.lease_id = (c.result -> 'lease' ->> 'lease_id')::uuid
      and j.lease_expires_at = (c.result -> 'lease' ->> 'expires_at')::timestamptz
      and j.status = 'processing'
   from public.jobs j, claims c
   where j.id = '00000000-0000-4000-8000-0000000000a1' and c.n = 2),
  '저장한 lease가 응답 lease와 같다'
);
select isnt(
  (select lease_id from public.jobs where id = '00000000-0000-4000-8000-0000000000e1'),
  '00000000-0000-4000-8000-0000000001e1'::uuid,
  '되찾은 job은 새 lease_id를 받는다'
);
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000c1'),
  'created',
  'created job은 가져가지 않는다'
);
select is(
  (select lease_id from public.jobs where id = '00000000-0000-4000-8000-0000000000b1'),
  '00000000-0000-4000-8000-0000000001b1'::uuid,
  '기한 남은 processing job은 가져가지 않는다'
);

-- renew
select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1'),
  jsonb_build_object('kind', 'renewed', 'expires_at', now() + interval '5 minutes'),
  '기한 전 같은 lease_id는 DB 시각 + 5분으로 연장한다'
);
select is(
  (select lease_expires_at from public.jobs where id = '00000000-0000-4000-8000-0000000000b1'),
  now() + interval '5 minutes',
  'renew는 저장한 기한을 바꾼다'
);
select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000b1', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  '다른 lease_id는 stale이다'
);
select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000001e1'),
  '{"kind": "stale"}'::jsonb,
  '다른 Worker가 되찾은 job의 옛 lease_id는 stale이다'
);
select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000c1', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  'processing이 아닌 job은 stale이다'
);
select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000f9', gen_random_uuid()),
  '{"kind": "stale"}'::jsonb,
  '없는 job은 stale이다'
);

-- 기한이 지난 lease는 같은 lease_id라도 연장하지 않는다.
reset role;

update public.jobs set lease_expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-0000000000b1';

set local role service_role;

select is(
  public.renew_job_lease_v1('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1'),
  '{"kind": "stale"}'::jsonb,
  '기한 지난 lease는 같은 lease_id라도 stale이다'
);
select is(
  (select lease_expires_at from public.jobs where id = '00000000-0000-4000-8000-0000000000b1'),
  now() - interval '1 second',
  'stale renew는 기한을 바꾸지 않는다'
);
select is(
  public.claim_job_v1() -> 'job' ->> 'id',
  '00000000-0000-4000-8000-0000000000b1',
  '기한 지난 lease의 job은 다시 claim된다'
);

-- authenticated 호출 거부
set local role authenticated;

select is(current_user::text, 'authenticated', 'authenticated로 실행 중이다');
select throws_ok(
  $$select public.claim_job_v1()$$,
  '42501', null, 'authenticated는 claim_job_v1을 호출할 수 없다'
);
select throws_ok(
  $$select public.renew_job_lease_v1(gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'authenticated는 renew_job_lease_v1을 호출할 수 없다'
);

reset role;

select * from finish();

rollback;
