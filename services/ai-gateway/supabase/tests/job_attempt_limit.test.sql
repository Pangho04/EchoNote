begin;

select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test');

delete from public.jobs;

-- transaction 안에서 now()는 고정이다. 기한은 now() 기준 상대값으로 만든다.
-- d2·d3은 lease가 끝났고 각각 2번·3번 잡혔던 job, q1은 처음 잡히는 job이다.
insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at, lease_id, lease_expires_at, attempt_count)
values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '2 hours', '00000000-0000-4000-8000-0000000001d2', now() - interval '1 second', 2),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'processing',
   now() - interval '3 hours', '00000000-0000-4000-8000-0000000001d3', now() - interval '1 second', 3);

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status,
  created_at)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'queued',
   now() - interval '1 hour');

-- 구조
select col_default_is('public', 'jobs', 'attempt_count', '0', 'attempt_count 기본값은 0이다');
select col_not_null('public', 'jobs', 'attempt_count', 'attempt_count는 null일 수 없다');
select throws_ok(
  $$update public.jobs set attempt_count = -1 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'attempt_count는 음수가 될 수 없다'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.claim_job_v1'::regproc),
  true,
  'claim_job_v1은 security definer로 남는다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.claim_job_v1'::regproc) @> array['search_path=""'],
  'claim_job_v1은 빈 search_path로 남는다'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_job_v1()', 'execute')
    and has_function_privilege('service_role', 'public.claim_job_v1()', 'execute'),
  'claim_job_v1은 service_role만 실행한다'
);

set local role service_role;

-- 첫 claim이 d3을 failed로 확정한 뒤 d2를 세 번째로 잡는다.
select is(
  public.claim_job_v1() -> 'job' ->> 'id',
  '00000000-0000-4000-8000-0000000000d2',
  '2번 잡혔던 만료 job은 다시 잡힌다'
);
select ok(
  (select status = 'failed' and lease_id is null and lease_expires_at is null and attempt_count = 3
   from public.jobs where id = '00000000-0000-4000-8000-0000000000d3'),
  '3번 잡혔던 만료 job은 failed가 되고 lease 두 열을 비운다'
);
select is(
  (select attempt_count from public.jobs where id = '00000000-0000-4000-8000-0000000000d2'),
  3,
  'claim은 attempt_count를 1 올린다'
);
select is(
  public.claim_job_v1() -> 'job' ->> 'id',
  '00000000-0000-4000-8000-0000000000a1',
  'queued job을 잡는다'
);
select is(
  (select attempt_count from public.jobs where id = '00000000-0000-4000-8000-0000000000a1'),
  1,
  '처음 잡힌 job은 attempt_count가 1이다'
);

reset role;

-- 세 번째 lease도 끝나면 다음 claim이 failed로 확정한다.
update public.jobs set lease_expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-0000000000d2';

set local role service_role;

select is(public.claim_job_v1() ->> 'kind', 'idle', '세 번째 lease가 끝난 job은 다시 잡히지 않는다');
select is(
  (select status from public.jobs where id = '00000000-0000-4000-8000-0000000000d2'),
  'failed',
  '세 번째 lease가 끝난 job은 failed가 된다'
);

reset role;

select * from finish();

rollback;
