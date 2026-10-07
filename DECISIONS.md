# DECISIONS

개발 중 마주친 문제와 그에 대해 내린 결정을 적습니다. 「왜 이렇게 했나」만 추려 적었습니다.

## 1. 녹음 파일을 클라우드에 올리지 않고 PC로 직접 보낸다

**배경** — 회의 녹음은 사람 목소리가 그대로 담긴 민감한 데이터입니다. 전사(transcription, 음성을 텍스트로 바꾸는 작업)는 개인 PC(Windows, NVIDIA GPU)에서 하기로 했지만 앱에서 그 PC까지 파일을 어떻게 보낼지가 문제였습니다.

흔한 방법은 Vercel Gateway나 Supabase Storage에 파일을 올렸다가 Worker가 내려받는 구조인데, 이러면 원본 음성이 외부 클라우드에 한 번 머물게 됩니다.

**고려한 대안** — 클라우드 저장소를 거치는 안은 원본이 외부에 머물러서 버렸습니다. Worker 수신기를 tailnet IP나 `0.0.0.0`에 바인드(bind, 특정 주소·포트에서만 요청을 받게 고정하는 것)하는 안도 검토했습니다. tailnet IP는 Tailscale Serve가 중계하는 의미를 없애고, `0.0.0.0`은 LAN 전체에 수신기를 노출시켜 둘 다 버렸습니다.

**결정**

- 앱은 Gateway에 "이 회의를 전사해도 되는지"만 묻고 작업(job)을 만듭니다.
- Gateway는 짧은 수명의 업로드 허가(grant, HS256 JWT)를 발급하고 녹음 파일은 Gateway를 거치지 않고 Tailscale을 통해 개인 PC로 직접 전송됩니다.
- 수신기는 loopback(127.0.0.1, 같은 기기 안에서만 통하는 주소)에만 bind합니다.
- grant는 jti(토큰 고유 번호)를 한 번만 소비하도록 기록해 같은 토큰으로 두 번 업로드하지 못하게 막습니다.
- 수신한 파일은 temp 경로에 먼저 쓰고 길이·SHA-256 해시·magic byte를 검증한 뒤에만 hard link로 final 경로에 확정합니다.

**결과** — 녹음 원본은 어떤 단계에서도 Vercel이나 Supabase를 거치지 않습니다. 외부에서 PC 수신기에 직접 접근할 수 있는 경로는 Tailscale Serve 하나뿐이고 그 경로조차 1회용 grant 없이는 통과하지 못합니다.

전송이 중간에 끊겨도 검증을 통과하지 못한 temp 파일만 남아 final 파일이 깨질 일이 없습니다.

**이 결정을 지키는 테스트** — `services/inference-worker/src/uploads/nonce-store.test.ts`의 "같은 jti는 한 번만 소비한다", `services/inference-worker/src/uploads/receive-upload.test.ts`의 "stream이 중간에 실패하면 final·temp를 남기지 않는다"

**코드** — `services/inference-worker/src/index.ts`, `services/inference-worker/src/uploads`

## 2. 작업 점유권(lease)으로 Worker 중단을 처리한다

**배경** — Worker는 PC 한 대에서 상시 실행되는 프로세스입니다. 전사 중에 프로세스가 죽거나 PC가 재시작되면, 그 작업이 "처리 중"인지 "버려졌는지" Gateway와 DB 입장에서는 구분할 수 없습니다.

작업을 아무도 다시 가져가지 못하면 영원히 멈춘 job이 됩니다.

**결정**

- job을 가져갈 때(`claim_job`) lease_id(점유권 식별자)와 만료 시각을 함께 발급합니다.
- Worker는 전사가 오래 걸리면 주기적으로 lease를 갱신(renew)해 만료 시각을 늦춥니다.
- lease가 만료되면 다른 Worker 기동이나 다음 claim 시도가 그 job을 다시 가져갈 수 있습니다.
- 실패 확정(`fail_job`)과 완료 확정(`complete_job`)은 모두 "상태가 processing이고, lease_id가 일치하고, 아직 만료되지 않았을 때"만 통과하도록 조건을 걸었습니다.
- claim을 3회 반복해도 끝나지 않으면 DB가 직접 `attempts_exhausted`로 실패를 확정해 Worker가 없는 상태에서도 job이 영원히 대기하지 않게 합니다.

**결과** — Worker가 죽어도 그 job은 lease 만료 뒤 자동으로 다른 처리 시도로 넘어갑니다.

옛 lease를 쥔 요청이 늦게 도착해도 lease_id 불일치로 거부되므로, 두 Worker가 같은 job을 동시에 완료 처리해 결과가 뒤섞이는 일이 없습니다.

**이 결정을 지키는 테스트** — `services/ai-gateway/supabase/tests/job_leases.test.sql`의 "기한 지난 processing을 먼저, 그다음 queued를 created_at 순으로 가져간다", `services/ai-gateway/src/jobs/job-repository.db.test.ts`의 "queued job 둘에 동시 claim 10건은 두 job을 한 번씩만 가져가고 그 lease로만 연장·실패 확정된다"

**코드** — `services/ai-gateway/supabase/migrations/20260926125300_init.sql`, `services/inference-worker/src/jobs/job-runner.ts`, `services/inference-worker/src/jobs/job-lease-client.ts`

## 3. Docker CLI를 execFile로 직접 실행한다

**배경** — Worker는 전사마다 Docker 컨테이너를 하나씩 만들어 GPU로 Whisper 모델을 돌립니다. Docker를 TypeScript에서 제어하는 방법은 CLI를 서브프로세스로 호출하는 방법과, Docker Engine API를 SDK(dockerode 등)로 직접 호출하는 방법 두 가지가 있었습니다.

**고려한 대안** — dockerode 같은 Docker Engine API SDK를 검토했지만 Windows에서는 named pipe 설정이 추가로 필요하고 새 의존성이 늘어납니다. CLI는 Docker Desktop을 설치하면 이미 쓸 수 있어서 버렸습니다.

**결정**

- `docker` CLI를 Node.js `execFile`로 호출합니다.
- `shell: false`로 호출해 인자가 셸 명령으로 재해석되지 않게 하고 환경 변수는 `DOCKER_ENV_KEYS`에 정의한 7개(SystemRoot·PATH·HOME·USERPROFILE·APPDATA·LOCALAPPDATA·ProgramData)만 넘깁니다.
- `process.env` 전체를 넘기지 않은 이유는 Worker 프로세스의 환경에 Gateway token과 upload secret이 들어 있기 때문입니다.
- 출력은 64 KiB로 제한하고 `wait`를 제외한 모든 호출에 30초 타임아웃을 겁니다.
- 모든 docker 호출은 `spawnDocker`라는 단일 통로를 거칩니다.

**결과** — Docker 호출 경로가 하나로 좁혀져 타임아웃·출력 크기·환경 변수 노출을 한곳에서 관리합니다.

CLI가 컨테이너 안으로 비밀 값을 흘릴 경로가 막혀 있습니다.

**이 결정을 지키는 테스트** — `services/inference-worker/src/stt/docker-transcriber.test.ts`의 "shell 없이, 창 없이, 허용한 env만 넘기고 출력·시간 상한을 둔다"

**코드** — `services/inference-worker/src/stt/docker-transcriber.ts`

## 4. 전사 결과 저장을 하나의 DB transaction으로 묶는다

**배경** — 전사가 끝나면 job 상태를 completed로 바꾸고 전사 결과(문장별 텍스트)를 함께 저장해야 합니다. 두 작업이 따로 실행되면, 상태만 completed로 바뀌고 결과 저장은 실패하는 반쪽짜리 상태가 생길 수 있습니다.

**고려한 대안** — 세그먼트(문장 단위 구간)를 행별로 저장하는 테이블 구조도 검토했지만 insert를 여러 번 나눠 실행해야 해서 부분 저장이 구조적으로 가능해집니다. 하나의 jsonb 열에 세그먼트 배열 전체를 담는 방식을 택했습니다.

**결정**

- `complete_job`이라는 Postgres 함수 하나를 Gateway가 RPC로 호출합니다.
- 이 함수 안에서 job 상태를 업데이트하고 전사 결과를 삽입하는 두 동작이 하나의 transaction으로 실행됩니다.
- 상태 업데이트는 "processing이고 lease_id가 일치하고 아직 만료되지 않았을 때"만 적용되며 조건에 안 맞으면 `stale`을 반환하고 아무것도 바꾸지 않습니다.
- 업데이트가 통과한 뒤 결과 삽입이 실패하면(세그먼트가 배열이 아니거나 제약 위반 등) 예외가 발생해 상태 업데이트까지 함께 rollback됩니다. (8번 결정으로 지금은 이 열이 암호문 text 열로 바뀌었고 배열 검사는 Gateway의 Zod가 맡습니다)

**결과** — job이 completed인데 전사 결과가 없거나, 결과만 있고 상태가 바뀌지 않은 상태는 나올 수 없습니다.

저장이 실패하면 job은 processing으로 남아 다시 완료를 시도할 수 있습니다.

**이 결정을 지키는 테스트** — `services/ai-gateway/supabase/tests/complete_job.test.sql`의 "기한 전 같은 lease_id는 completed다"

**코드** — `services/ai-gateway/supabase/migrations/20260926125300_init.sql`

## 5. 전사 실패 이유를 6종 코드로 고정해 보여준다

**배경** — job이 `failed` 상태라는 것만 보여주면 사용자가 다시 시도해야 하는지, 포기해야 하는지 판단할 수 없습니다. 실패 원인은 "녹음 파일을 못 찾음", "PC의 음성 인식이 꺼짐", "모델 실행 자체가 실패함" 등 성격이 다른데, 이를 구분해서 보여줄 방법이 필요했습니다.

**결정**

- `jobFailureCodeSchema`에 `audio_missing`·`stt_unavailable`·`stt_failed`·`result_rejected`·`attempts_exhausted`·`unexpected` 6종을 고정했습니다.
- Worker가 보내는 실패 요청(`failJobRequestSchema`)은 `attempts_exhausted`를 Zod의 `exclude`로 아예 뺐습니다.
- 이 값은 `claim_job` RPC가 claim을 3회 반복해도 끝나지 않은 job을 DB가 직접 `failed`로 확정할 때만 씁니다.
- `jobs.error_code` 열은 known 목록 check와 "status가 failed일 때만 값이 있어야 한다"는 check 두 개로 제약했습니다.
- 앱은 코드별로 미리 정한 문구를 보여줍니다.

**결과** — 실패 이유가 자유 문자열이 아니라 6개로 닫혀 있어 앱의 문구 매핑표가 늘어날 일이 없습니다.

`attempts_exhausted`는 Worker가 보내려 해도 스키마가 막아서, 이 값의 유일한 출처가 DB 자체 판단으로 좁혀집니다.

**이 결정을 지키는 테스트** — `services/ai-gateway/src/jobs/worker-jobs-routes.test.ts`의 "failed는 body 없는 204이고 jobId·leaseId·errorCode를 repository에 넘긴다"

**코드** — `packages/contracts/src/job.ts`, `services/ai-gateway/supabase/migrations/20260926125300_init.sql`

## 6. 서버 상태와 로컬 표시 상태를 다른 축으로 나눈다

**배경** — 초기 설계에서는 job 상태 enum 하나에 `waiting_for_node`·`uploading`·`transcribing`·`reviewing`·`summarizing`·`cancelled` 등 9개 값을 모두 담았습니다. 이 값들은 업로드 진행(모바일이 주체), 분석 세부 단계(Worker가 주체), 서버 처리 단계(Gateway·Worker가 주체)가 한 enum에 섞여 있어 모바일이 업로드 진행 상태를 서버 job 상태로 오해하기 쉬운 구조였습니다.

**고려한 대안** — 9개 상태를 그대로 두는 안은 소유권 혼선을 그대로 남깁니다. 분석 세부 단계(transcribing/reviewing/summarizing)를 job 상태로 유지하는 안도 검토했지만 MVP 화면에는 "처리 중" 하나로 충분하고 세부 구분은 과한 설계라 버렸습니다.

**결정**

- 서버 job 상태는 `created`·`queued`·`processing`·`completed`·`failed` 5개로 줄이고 Supabase를 이 값의 원본으로 둡니다.
- 앱의 `MeetingStatus`는 여기에 로컬 전용 값 `LocalOnly`(아직 업로드 전) 하나를 더해 6개로 관리합니다.
- `MEETING_STATUS_LABELS`를 `Record<MeetingStatus, ...>` 타입으로 선언해 상태가 늘어나는데 라벨이 안 늘면 typecheck에서 바로 막힙니다.
- 업로드 진행은 서버 job 상태에 넣지 않고, 상세 화면의 전송 중(`sending`) 표시와 진행률로만 다룹니다.

**결과** — 서버 상태는 Supabase가, 로컬 표시는 앱이 각자의 원본을 갖습니다. 업로드 진행과 서버 처리 단계가 한 값에 섞여 어느 한쪽이 다른 쪽을 덮어쓰는 일이 없습니다.

**이 결정을 지키는 테스트** — `packages/contracts/src/job.test.ts`, `apps/mobile/src/entities/meeting/model/meeting-list-item-view-model.unit.test.ts`

**코드** — `packages/contracts/src/job.ts`, `apps/mobile/src/entities/meeting/model/meeting.ts`, `apps/mobile/src/entities/meeting/model/meeting-list-item-view-model.ts`

## 7. 사용자별로 공정하게 작업을 가져가는 순서를 만든다

**배경** — 여러 사용자가 같은 Worker를 쓴다고 가정하면, 한 사용자가 연달아 여러 건을 올렸을 때 그 사용자의 작업이 대기열을 전부 차지하고 다른 사용자가 한참 기다리는 상황이 생길 수 있습니다. job 생성 시각(`created_at`) 순으로만 가져가면 이 문제가 그대로 남습니다.

**고려한 대안** — 대기 중인 job끼리 사용자별로 번호를 매겨 순서를 정하는 방식을 검토했지만 한 사용자의 첫 job이 끝나면 그 사용자의 둘째 job이 다시 그 사용자의 1번이 되어 버려 Worker가 한 대뿐인 환경에서는 결국 생성 순서(FIFO)와 같아진다는 것을 DB 테스트로 확인하고 버렸습니다. `transcripts.created_at`을 "마지막으로 처리받은 시각"으로 쓰는 방식도 검토했지만 버렸습니다.

**결정**

- `jobs` 테이블에 `claimed_at`(마지막으로 작업이 가져가진 시각) 열을 추가했습니다.
- `claim_job`이 job을 고르는 순서는 멈춘 Worker의 job을 먼저 되찾고, 그다음 가장 오래 처리받지 못한 사용자(한 번도 처리받지 못했으면 맨 앞)의 job을, 그 안에서는 오래된 job을 먼저 가져가는 순서입니다.
- 함수 이름과 반환 모양은 그대로 유지해 확장→축소(expand/contract) 절차가 필요 없었고 새 열은 비어 있어도 되므로 옛 Gateway에도 영향이 없습니다.

**결과** — 한 사용자가 job을 몰아서 올려도 다른 사용자의 job이 그 뒤에 영원히 묻히지 않습니다. Worker가 한 대뿐인 지금 환경에서도, 사용자가 늘어났을 때 공정성이 깨지지 않는 순서를 미리 갖춰 뒀습니다.

**이 결정을 지키는 테스트** — `services/ai-gateway/src/jobs/job-repository.db.test.ts`의 "A가 job 둘을 먼저 올려도 뒤에 올린 B의 job을 A의 둘째보다 먼저 가져간다"

**코드** — `services/ai-gateway/supabase/migrations/20261003140000_claim_job_owner_fairness.sql`

## 8. 전사문을 Gateway가 봉투 암호화해 저장한다

**배경** — Supabase `transcripts`에 전사 결과를 그대로 저장하면 Supabase 콘솔 열람, DB 덤프, 백업, SQL 주입, 키 없는 역할 등 Supabase 쪽에서 일어나는 어떤 유출로도 회의 내용이 그대로 드러납니다. Supabase는 디스크를 AES-256으로 항상 암호화하지만 질의가 닿는 순간 평문이 되므로 이 at-rest 암호화만으로는 콘솔·덤프에서 평문이 그대로 보이는 문제를 막지 못합니다.

**고려한 대안** — Supabase Vault는 복호화 뷰가 Postgres 권한으로 열려 `postgres`·`service_role`이 결국 평문을 볼 수 있고, 컬럼 암호화에 쓰는 pgsodium은 Supabase가 폐기 예정으로 두고 있어 버렸습니다. 종단간 암호화(E2E, 서버도 못 읽는 방식)도 검토했지만 앱의 열쇠를 잃으면 서버의 전사문을 되찾을 길이 없어 복구 설계가 먼저 필요하고, 서버에서 전사문을 검색하거나 요약을 만드는 확장도 막혀서 이번에는 미뤘습니다. 운영자도 읽지 못하게 해야 하는 요구가 생기면 그때 다시 검토합니다.

**결정**

- Gateway가 전사 결과를 저장하기 전에 행마다 무작위 데이터 키(DEK, 32바이트)를 만들어 AES-256-GCM으로 전사문을 잠급니다.
- DEK는 열쇠 키(KEK)로 다시 잠가 같은 행에 함께 둡니다. `segments_sealed`, `dek_sealed`, `key_version`(지금은 1) 열에 저장합니다.
- KEK는 환경 변수 `TRANSCRIPT_KEK_B64`로 Gateway 실행 환경에만 두고 Supabase·저장소·앱·Worker에는 두지 않습니다.
- 추가 인증 데이터(aad)에 job_id·버전·용도를 넣어, 다른 행의 암호문을 바꿔치기하면 복호화가 실패하게 합니다.
- 복호화는 Gateway가 `GET /v1/jobs/:jobId/transcript`에서만 하고 앱에 내려주는 응답 모양은 그대로 둡니다.
- 기존 평문 행은 1회용 스크립트 `services/ai-gateway/src/scripts/seal-existing-transcripts.ts`로 감쌉니다. 운영 Gateway가 만든 암호문을 먼저 열어 KEK가 맞는지 확인한 뒤 행마다 잠그고, 다시 열어 검증한 다음 `seal_transcript` RPC로 반영합니다.
- migration은 확장→축소(expand/contract) 순서를 따릅니다. 확장 migration `20261006120000_seal_transcripts.sql`은 평문·암호문 열을 공존시키고 `complete_job`이 옛 평문 호출도 받게 하며, 평문 열 삭제는 다음 migration에서 따로 합니다.

**결과** — Supabase 단독 유출(콘솔 열람·덤프·백업·SQL 주입·키 없는 역할)로는 전사문을 읽을 수 없습니다. 반면 Vercel 환경 변수와 Gateway 실행 환경을 가진 쪽, 즉 운영자는 여전히 복호화할 수 있고 `duration_ms`와 암호문 길이는 평문 메타데이터로 남습니다.

KEK를 잃으면 서버에 있는 전사문은 복구할 수 없고 앱 SQLite 사본만 남습니다. 적용 전에 뜬 백업과 DB 내부에 남은 옛 행 조각(dead tuple)은 이 조치로 소급 정리되지 않으며 vacuum으로 따로 정리해야 합니다.

**이 결정을 지키는 테스트** — `services/ai-gateway/src/jobs/transcript-cipher.test.ts`의 "변조한 암호문은 열리지 않는다", `services/ai-gateway/src/jobs/job-repository.db.test.ts`의 "완료한 전사는 암호문으로 저장되고 왕복한다", `services/ai-gateway/supabase/tests/complete_job.test.sql`

**코드** — `services/ai-gateway/src/jobs/transcript-cipher.ts`, `services/ai-gateway/src/jobs/job-repository.ts`, `services/ai-gateway/supabase/migrations/20261006120000_seal_transcripts.sql`

## 앞으로 할 일

- Electron 데스크탑 앱 — 현재 보류 상태이며 모바일 완성 이후 다시 다룰 계획입니다.
