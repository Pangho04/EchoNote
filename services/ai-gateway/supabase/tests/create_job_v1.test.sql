begin;

select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'owner-b@example.test');

-- 구조
select columns_are(
  'public', 'jobs',
  array['id', 'owner_id', 'meeting_id', 'size_bytes', 'sha256', 'mime_type', 'status',
        'idempotency_key', 'created_at']
);
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'jobs' and is_nullable = 'YES'),
  0::bigint,
  'jobs의 모든 열은 NOT NULL이다'
);
select col_is_unique('public', 'jobs', array['owner_id', 'idempotency_key']);
select ok(
  (select proconfig from pg_proc where oid = 'public.create_job_v1'::regproc)
    @> array['search_path=""'],
  'create_job_v1은 빈 search_path로 실행된다'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.create_job_v1'::regproc),
  false,
  'create_job_v1은 security invoker다'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_job_v1'),
  1::bigint,
  'create_job_v1 overload는 하나다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.create_job_v1(uuid,uuid,uuid,bigint,text,text)', 'execute'),
  'anon은 create_job_v1을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_job_v1(uuid,uuid,uuid,bigint,text,text)', 'execute'),
  'authenticated는 create_job_v1을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.create_job_v1(uuid,uuid,uuid,bigint,text,text)', 'execute'),
  'service_role은 create_job_v1을 실행할 수 있다'
);
select table_privs_are('public', 'jobs', 'service_role', array['SELECT', 'INSERT']);
select table_privs_are('public', 'jobs', 'anon', array[]::text[]);
select table_privs_are('public', 'jobs', 'authenticated', array[]::text[]);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.jobs'::regclass),
  'jobs는 RLS가 켜져 있다'
);
select policies_are('public', 'jobs', array[]::name[], 'jobs에는 정책이 없다');
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.jobs'::regclass and contype = 'f'
     and confrelid = 'auth.users'::regclass),
  'c'::"char",
  'owner_id는 auth.users를 on delete cascade로 참조한다'
);

-- CHECK
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 0, repeat('a', 64), 'audio/mp4')$$,
  '23514', null, 'size_bytes 0은 거부한다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 536870913, repeat('a', 64), 'audio/mp4')$$,
  '23514', null, 'size_bytes 536870913은 거부한다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 1, repeat('A', 64), 'audio/mp4')$$,
  '23514', null, '대문자 sha256은 거부한다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 1, repeat('a', 64), 'audio/mpeg')$$,
  '23514', null, 'audio/mpeg는 거부한다'
);
select throws_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 1, repeat('a', 64), 'audio/mp4', 'done')$$,
  '23514', null, '정의되지 않은 status는 거부한다'
);
select lives_ok(
  $$insert into public.jobs (owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type)
    values ('00000000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), 536870912, repeat('a', 64), 'audio/mp4')$$,
  'size_bytes 536870912는 허용한다'
);

-- service_role 호출
set local role service_role;

select is(current_user::text, 'service_role', 'service_role로 실행 중이다');
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'created',
  '새 key는 created다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'existing',
  '같은 key·payload는 existing이다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') -> 'job' ->> 'id',
  (select id::text from public.jobs
   where owner_id = '00000000-0000-4000-8000-00000000000a'
     and idempotency_key = '00000000-0000-4000-8000-000000000001'),
  'existing은 처음 만든 row의 id를 돌려준다'
);
select is(
  (select array_agg(key order by key) from jsonb_object_keys(
    public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') -> 'job') as key),
  array['created_at', 'id', 'meeting_id', 'mime_type', 'sha256', 'size_bytes', 'status'],
  'job은 7개 키를 가진다'
);
select matches(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') -> 'job' ->> 'created_at',
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:[0-9]{2}|Z)$',
  'created_at은 ISO 8601 형식이다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000d', 100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'conflict',
  'meeting_id가 다르면 conflict다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 101, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'conflict',
  'size_bytes가 다르면 conflict다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('b', 64), 'audio/mp4') ->> 'kind',
  'conflict',
  'sha256이 다르면 conflict다'
);
-- CHECK는 on conflict 판정보다 먼저 평가된다.
select throws_ok(
  $$select public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mpeg')$$,
  '23514', null, '같은 key여도 허용하지 않는 mime_type은 CHECK로 거부한다'
);
select ok(
  not (public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000d', 100, repeat('a', 64), 'audio/mp4') ? 'job'),
  'conflict는 job을 담지 않는다'
);
select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'created',
  '다른 owner는 같은 key로도 created다'
);
select isnt(
  (select id from public.jobs
   where owner_id = '00000000-0000-4000-8000-00000000000b'
     and idempotency_key = '00000000-0000-4000-8000-000000000001'),
  (select id from public.jobs
   where owner_id = '00000000-0000-4000-8000-00000000000a'
     and idempotency_key = '00000000-0000-4000-8000-000000000001'),
  '다른 owner의 row는 id가 다르다'
);

-- existing은 현재 status를 돌려준다
reset role;

update public.jobs set status = 'queued'
where owner_id = '00000000-0000-4000-8000-00000000000a'
  and idempotency_key = '00000000-0000-4000-8000-000000000001';

set local role service_role;

select is(
  public.create_job_v1('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000000c', 100, repeat('a', 64), 'audio/mp4') -> 'job' ->> 'status',
  'queued',
  'existing은 바뀐 status를 돌려준다'
);

-- authenticated 호출 거부
set local role authenticated;

select is(current_user::text, 'authenticated', 'authenticated로 실행 중이다');
select throws_ok(
  $$select public.create_job_v1('00000000-0000-4000-8000-00000000000a', gen_random_uuid(),
    gen_random_uuid(), 1, repeat('a', 64), 'audio/mp4')$$,
  '42501', null, 'authenticated는 create_job_v1을 호출할 수 없다'
);

reset role;

select * from finish();

rollback;
