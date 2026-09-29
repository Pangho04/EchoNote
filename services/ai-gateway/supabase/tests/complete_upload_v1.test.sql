begin;

select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'owner-b@example.test');

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'created');

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  lease_id, lease_expires_at)
values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   gen_random_uuid(), now() + interval '5 minutes');

-- 구조
select is(
  (select prosecdef from pg_proc where oid = 'public.complete_upload_v1'::regproc),
  true,
  'complete_upload_v1은 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.complete_upload_v1'::regproc)
    @> array['search_path=""'],
  'complete_upload_v1은 빈 search_path로 실행된다'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_upload_v1'),
  1::bigint,
  'complete_upload_v1 overload는 하나다'
);
select is(
  (select proowner from pg_proc where oid = 'public.complete_upload_v1'::regproc),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'complete_upload_v1 소유자는 jobs 소유자다'
);
select ok(
  not (select relforcerowsecurity from pg_class where oid = 'public.jobs'::regclass),
  'jobs 소유자는 RLS를 우회한다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.complete_upload_v1(uuid,uuid,bigint,text,text)', 'execute'),
  'anon은 complete_upload_v1을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.complete_upload_v1(uuid,uuid,bigint,text,text)', 'execute'),
  'authenticated는 complete_upload_v1을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.complete_upload_v1(uuid,uuid,bigint,text,text)', 'execute'),
  'service_role은 complete_upload_v1을 실행할 수 있다'
);
select table_privs_are('public', 'jobs', 'service_role', array['SELECT', 'INSERT']);

-- service_role 호출
set local role service_role;

select is(current_user::text, 'service_role', 'service_role로 실행 중이다');
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('b', 64), 'audio/mp4') ->> 'kind',
  'conflict',
  'sha256이 다르면 conflict다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    101, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'conflict',
  'size_bytes가 다르면 conflict다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mpeg') ->> 'kind',
  'conflict',
  'mime_type이 다르면 conflict다'
);
select ok(
  not (public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('b', 64), 'audio/mp4') ? 'job'),
  'conflict는 job을 담지 않는다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000b',
    100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'not_found',
  '다른 owner의 job은 not_found다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'not_found',
  '없는 job은 not_found다'
);
select ok(
  not (public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000b',
    100, repeat('a', 64), 'audio/mp4') ? 'job'),
  '다른 owner의 not_found는 job을 담지 않는다'
);
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000f1'),
  'created',
  'conflict·not_found는 status를 바꾸지 않는다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'queued',
  'created job의 일치 통지는 queued다'
);
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000f1'),
  'queued',
  'queued 통지는 status를 queued로 바꾼다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'existing',
  'queued job의 같은 통지는 existing이다'
);
select is(
  (select array_agg(key order by key) from jsonb_object_keys(
    public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
      100, repeat('a', 64), 'audio/mp4') -> 'job') as key),
  array['created_at', 'id', 'meeting_id', 'mime_type', 'sha256', 'size_bytes', 'status'],
  'job은 create_job_v1과 같은 7개 키를 가진다'
);
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000f1'),
  'queued',
  'queued job의 existing 통지는 status를 바꾸지 않는다'
);
select is(
  public.complete_upload_v1('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mp4') ->> 'kind',
  'existing',
  'processing job의 같은 통지는 existing이다'
);
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000f2'),
  'processing',
  'processing job의 통지는 status를 바꾸지 않는다'
);

-- authenticated 호출 거부
set local role authenticated;

select is(current_user::text, 'authenticated', 'authenticated로 실행 중이다');
select throws_ok(
  $$select public.complete_upload_v1('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    100, repeat('a', 64), 'audio/mp4')$$,
  '42501', null, 'authenticated는 complete_upload_v1을 호출할 수 없다'
);

reset role;

select * from finish();

rollback;
