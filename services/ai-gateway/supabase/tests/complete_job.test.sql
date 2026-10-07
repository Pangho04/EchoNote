begin;

select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test');

delete from public.jobs;

-- transaction 안에서 now()는 고정이다. 기한은 now() 기준 상대값으로 만든다.
insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at, lease_id, lease_expires_at)
values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '2 hours', '00000000-0000-4000-8000-0000000001b1', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '1 hour', '00000000-0000-4000-8000-0000000001b2', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '1 hour', '00000000-0000-4000-8000-0000000001c1', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '3 hours', '00000000-0000-4000-8000-0000000001e1', now() - interval '1 second');

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'queued'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'failed');

-- 구조
select is(
  (select prosecdef from pg_proc where oid = 'public.complete_job'::regproc),
  true,
  'complete_job은 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.complete_job'::regproc) @> array['search_path=""'],
  'complete_job은 빈 search_path로 실행된다'
);
select is(
  (select proowner from pg_proc where oid = 'public.complete_job'::regproc),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'complete_job 소유자는 jobs 소유자다'
);
select is(
  (select relowner from pg_class where oid = 'public.transcripts'::regclass),
  (select relowner from pg_class where oid = 'public.jobs'::regclass),
  'transcripts 소유자는 jobs 소유자다'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_job'),
  1::bigint,
  'complete_job overload는 하나다'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.transcripts'::regclass),
  true,
  'transcripts는 RLS가 켜져 있다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.complete_job(uuid,uuid,integer,text,text,integer)', 'execute'),
  'anon은 complete_job을 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.complete_job(uuid,uuid,integer,text,text,integer)', 'execute'),
  'authenticated는 complete_job을 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.complete_job(uuid,uuid,integer,text,text,integer)', 'execute'),
  'service_role은 complete_job을 실행할 수 있다'
);
select table_privs_are('public', 'transcripts', 'service_role', array['SELECT']);
select table_privs_are('public', 'transcripts', 'anon', array[]::text[]);
select table_privs_are('public', 'transcripts', 'authenticated', array[]::text[]);

set local role service_role;

-- 성공
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1',
    2000, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "completed"}'::jsonb,
  '기한 전 같은 lease_id는 completed다'
);
select ok(
  (select status = 'completed' and lease_id is null and lease_expires_at is null
   from public.jobs where id = '00000000-0000-4000-8000-0000000000b1'),
  'completed job은 lease 두 열을 비운다'
);
select ok(
  (select owner_id = '00000000-0000-4000-8000-00000000000a' and duration_ms = 2000
     and segments_sealed = repeat('A', 40) and dek_sealed = repeat('B', 80) and key_version = 1
   from public.transcripts where job_id = '00000000-0000-4000-8000-0000000000b1'),
  '전사 결과는 암호문으로 job owner와 함께 저장된다'
);
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1',
    2000, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  '이미 completed인 job에 다시 보내면 stale이다'
);
select is(
  (select count(*) from public.transcripts where job_id = '00000000-0000-4000-8000-0000000000b1'),
  1::bigint,
  '두 번째 complete는 전사 결과를 더하지 않는다'
);

select is(
  public.complete_job('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000001b1',
    1500, repeat('C', 40), repeat('D', 80), 1),
  '{"kind": "stale"}'::jsonb,
  '암호문으로 완료한 job에 다시 보내도 stale이다'
);
-- 제약 위반이면 insert가 실패하고 job은 processing으로 남는다.
select throws_ok(
  $$select public.complete_job('00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000001c1', 0, 'AAAA', repeat('B', 80), 2)$$,
  '23514', null, 'key_version 2는 거부한다'
);
select throws_ok(
  $$select public.complete_job('00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000001c1', 0, 'AAAA', repeat('B', 79), 1)$$,
  '23514', null, '80자가 아닌 dek_sealed는 거부한다'
);

-- stale
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000b2', gen_random_uuid(), 0, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  '다른 lease_id는 stale이다'
);
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000001e1',
    0, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  '기한 지난 lease는 같은 lease_id라도 stale이다'
);
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  'queued job은 stale이다'
);
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000f1', gen_random_uuid(), 0, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  'failed job은 stale이다'
);
select is(
  public.complete_job('00000000-0000-4000-8000-0000000000f9', gen_random_uuid(), 0, repeat('A', 40), repeat('B', 80), 1),
  '{"kind": "stale"}'::jsonb,
  '없는 job은 stale이다'
);
select ok(
  (select status = 'processing' and lease_id = '00000000-0000-4000-8000-0000000001b2'
   from public.jobs where id = '00000000-0000-4000-8000-0000000000b2')
  and (select status = 'failed' and lease_id is null
   from public.jobs where id = '00000000-0000-4000-8000-0000000000f1')
  and (select count(*) = 1 from public.transcripts),
  'stale complete는 job도 전사 결과도 바꾸지 않는다'
);

-- insert가 실패하면 completed 전이도 되돌아간다.
select throws_ok(
  $$select public.complete_job('00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000001c1', 0, null, repeat('B', 80), 1)$$,
  '23502', null, 'segments_sealed가 null이면 거부한다'
);
select ok(
  (select status = 'processing' and lease_id = '00000000-0000-4000-8000-0000000001c1'
   from public.jobs where id = '00000000-0000-4000-8000-0000000000c1')
  and not exists (select 1 from public.transcripts where job_id = '00000000-0000-4000-8000-0000000000c1'),
  '전사 저장이 실패하면 job은 processing으로 남는다'
);

-- completed job은 다시 claim되지 않는다. b2·c1(기한 남음)도 대상이 아니다.
select is(
  array[public.claim_job() -> 'job' ->> 'id', public.claim_job() -> 'job' ->> 'id',
    public.claim_job() ->> 'kind'],
  array['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'idle'],
  'completed job은 claim 대상이 아니다'
);

-- authenticated 호출 거부
set local role authenticated;

select is(current_user::text, 'authenticated', 'authenticated로 실행 중이다');
select throws_ok(
  $$select public.complete_job(gen_random_uuid(), gen_random_uuid(), 0, repeat('A', 40), repeat('B', 80), 1)$$,
  '42501', null, 'authenticated는 complete_job을 호출할 수 없다'
);

reset role;

select * from finish();

rollback;
