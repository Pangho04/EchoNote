begin;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@example.test');

delete from public.jobs;

insert into public.jobs (id, owner_id, idempotency_key, meeting_id, size_bytes, sha256, mime_type, status)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a',
   gen_random_uuid(), gen_random_uuid(), 100, repeat('a', 64), 'audio/mp4', 'completed');

insert into public.transcripts (job_id, owner_id, duration_ms, segments)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 1000,
  '[{"startMs": 0, "endMs": 1000, "text": "평문"}]'::jsonb);

-- 구조
select is(
  (select prosecdef from pg_proc where oid = 'public.seal_transcript'::regproc),
  true,
  'seal_transcript는 security definer다'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.seal_transcript'::regproc) @> array['search_path=""'],
  'seal_transcript는 빈 search_path로 실행된다'
);

-- 권한
select ok(
  not has_function_privilege('anon', 'public.seal_transcript(uuid,text,text,integer)', 'execute'),
  'anon은 seal_transcript를 실행할 수 없다'
);
select ok(
  not has_function_privilege('authenticated', 'public.seal_transcript(uuid,text,text,integer)', 'execute'),
  'authenticated는 seal_transcript를 실행할 수 없다'
);
select ok(
  has_function_privilege('service_role', 'public.seal_transcript(uuid,text,text,integer)', 'execute'),
  'service_role은 seal_transcript를 실행할 수 있다'
);

set local role service_role;

-- 암호문 하나가 null이면 제약 위반이고 행은 그대로다.
select throws_ok(
  $$select public.seal_transcript('00000000-0000-4000-8000-0000000000d1', 'AAAA', null, 1)$$,
  '23514', null, 'dek_sealed가 null이면 거부한다'
);
select ok(
  (select segments is not null and segments_sealed is null
   from public.transcripts where job_id = '00000000-0000-4000-8000-0000000000d1'),
  '거부된 호출은 행을 바꾸지 않는다'
);

-- 평문 행을 암호문으로 바꾼다.
select is(
  public.seal_transcript('00000000-0000-4000-8000-0000000000d1', 'AAAA', repeat('B', 80), 1),
  '{"kind": "sealed"}'::jsonb,
  '평문 행은 sealed다'
);
select ok(
  (select segments is null and segments_sealed = 'AAAA' and dek_sealed = repeat('B', 80)
     and key_version = 1
   from public.transcripts where job_id = '00000000-0000-4000-8000-0000000000d1'),
  '감싼 뒤 평문 열은 비고 암호문 열이 찬다'
);
select is(
  public.seal_transcript('00000000-0000-4000-8000-0000000000d1', 'CCCC', repeat('D', 80), 1),
  '{"kind": "not_found"}'::jsonb,
  '이미 감싼 행은 not_found다'
);
select is(
  public.seal_transcript(gen_random_uuid(), 'CCCC', repeat('D', 80), 1),
  '{"kind": "not_found"}'::jsonb,
  '없는 행은 not_found다'
);

select * from finish();

rollback;
