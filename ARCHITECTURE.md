# ARCHITECTURE

EchoNote 전체 구조와 전사(transcription, 음성을 텍스트로 바꾸는 작업) 요청 한 건이 지나가는 경로를 적습니다.

## 전체 그림

```text
[앱: iOS·Android, Expo RN]
    SQLite(기기 로컬 DB)·파일 영역에 녹음 원본 저장
    |
    | 1) 작업(job) 생성 요청(JWT 인증)
    v
[Vercel Gateway: Fastify API] <----> [Supabase: Auth·DB]
    |
    | 2) 업로드 허가(grant) 발급
    |
    | 3) 파일은 Gateway를 거치지 않고 Tailscale로 직접 전송
    v
[개인 PC(Windows): inference-worker]
    작업 점유(lease)로 작업을 가져감
    Docker 컨테이너에서 Whisper large-v3-turbo 모델로 전사
    |
    | 4) 결과를 Gateway가 잠가 Supabase에 저장
    v
[앱이 상태를 주기적으로 확인(polling)해 SQLite에 반영]
```

## 왜 이렇게 나눴나

제어 계층(작업 상태 관리, 인증, 권한 발급)과 실행 계층(파일 전송, GPU 연산)을 분리했습니다. 제어 계층은 Vercel과 Supabase의 무료 등급 위에서 돌아갈 만큼 가볍고 상시 접속 가능해야 합니다.

반면 녹음 파일 전송과 전사 연산은 무겁고 개인정보가 담긴 원본 음성을 다루므로 외부 서비스를 거치지 않아야 합니다. 이 두 성격이 섞이면 무료 한도를 넘기거나 민감한 파일이 클라우드에 남는 구조가 되므로, 처음부터 역할을 나눠 설계했습니다.

## 구성 요소

| 구성 요소                   | 역할                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `apps/mobile`               | iOS·Android 공통 Expo React Native 앱. 녹음, 재생, 목록, 전사 요청 화면               |
| `apps/desktop`              | Electron 메인·preload. 현재 보류 상태                                                 |
| `packages/contracts`        | 앱·Gateway·Worker가 함께 쓰는 Zod 스키마(입력 검증 규칙)                              |
| `services/ai-gateway`       | Vercel에 배포한 Fastify API. 인증, 작업 생성, 업로드 허가 발급, 결과 암호화·저장 중계 |
| `services/inference-worker` | Windows에서 상시 실행하는 TypeScript 프로세스. 작업을 가져가 Docker로 전사 실행       |
| `tools/stt-benchmark`       | 음성 인식(STT) 품질·후보 비교용 실험 도구                                             |

## 전사 요청 한 건의 순서

1. 사용자가 녹음하거나 m4a 파일을 선택합니다. (`apps/mobile/src/features/record-meeting`, `apps/mobile/src/features/record-meeting/model/import-recording.ts`)
2. 앱이 Supabase Auth JWT(로그인 토큰)로 Gateway에 작업(job) 생성을 요청합니다. (`services/ai-gateway/src/jobs/jobs-routes.ts`)
3. Gateway가 짧은 수명의 업로드 허가(grant, 서명된 토큰)를 발급합니다. (`services/ai-gateway/src/uploads/upload-grant-issuer.ts`)
4. 앱이 Tailscale을 통해 녹음 파일을 PC에 직접 PUT으로 전송합니다. 이 경로는 Gateway를 거치지 않습니다.
5. Worker가 lease(작업 점유권)로 대기 중인 job을 가져가 Docker 컨테이너에서 Whisper 모델로 전사합니다. (`services/inference-worker/src/jobs/job-runner.ts`, `services/inference-worker/src/stt/docker-transcriber.ts`)
6. Worker가 전사 결과를 Gateway에 보내면 Gateway가 봉투 암호화로 잠가 Supabase RPC로 결과를 저장하며 job을 completed로 바꿉니다. (`services/ai-gateway/src/jobs/worker-jobs-routes.ts`, `services/ai-gateway/src/jobs/transcript-cipher.ts`)
7. 앱이 주기적으로 job 상태를 확인(polling)해 SQLite에 반영하고 완료되면 전사 결과를 내려받아 문장 단위로 표시합니다. 상세 화면이 열려 있거나, 목록에 대기·변환 중 회의가 있을 때만 확인합니다. (`apps/mobile/src/features/request-transcription/model/use-transcription.ts`, `apps/mobile/src/features/request-transcription/model/sync-pending-transcriptions.ts`)

## 작업 상태 전이

```text
created --(업로드 성공 확인)--> queued --(Worker가 작업을 가져감)--> processing --(전사 끝)--> completed
                                                                            \--(처리 오류)--> failed
```

- `created` — Gateway가 작업을 만들었고 업로드가 아직 확인되지 않은 상태.
- `queued` — 업로드가 확인되어 Worker가 가져갈 수 있는 상태.
- `processing` — Worker가 lease를 쥐고 전사를 실행 중인 상태.
- `completed` — 결과가 저장되고 더는 바뀌지 않는 상태.
- `failed` — 처리 오류나 lease 만료로 끝난 상태. `error_code`에 원인이 남습니다.

`completed`와 `failed`는 어떤 이벤트가 와도 되돌리지 않습니다. 재처리가 필요하면 새 job을 만듭니다.

## 실패할 때

- **PC가 꺼져 있습니다.** 앱이 전사를 요청하기 전에 PC의 준비 상태를 확인하는 `/live` 엔드포인트를 호출합니다. 응답이 없으면 "데스크탑에 연결할 수 없습니다" 안내를 보여줍니다. PC를 깨우는 동작은 서버가 대신하지 않고 사용자가 직접 합니다. (`apps/mobile/src/features/request-transcription/api/desktop-live.ts`)
- **업로드 중 연결이 끊깁니다.** Worker 수신기는 길이·해시(SHA-256)·magic byte를 검증한 뒤에만 temp 파일을 final 파일로 확정(hard link)합니다. 검증 전에 끊기면 temp 파일만 남고 job은 그대로 대기 상태로 유지되어 새 grant로 다시 PUT하면 됩니다. (`services/inference-worker/src/uploads`)
- **Worker가 작업 도중 죽습니다.** job은 lease(점유권)와 만료 시각을 들고 있습니다. Worker가 멈추면 lease가 5분 뒤 만료되고 다음 Worker 기동 때 그 job을 처음부터 다시 가져갑니다.
  claim을 3회 반복해도 끝나지 않으면 DB가 직접 `attempts_exhausted`로 실패를 확정합니다. (`services/ai-gateway/supabase/migrations/20260926125300_init.sql`)
- **결과 저장이 실패합니다.** 결과 저장은 `complete_job` RPC 한 번의 DB transaction으로 묶여 있습니다. 저장 중 하나라도 실패하면 상태 변경과 결과 삽입이 모두 되돌려지고 job은 `processing`으로 남아 다시 완료를 시도할 수 있습니다. (`services/ai-gateway/supabase/migrations/20260926125300_init.sql`)
- **파일이 512 MiB를 넘습니다.** 앱이 업로드를 시작하기 전에 파일 크기를 확인해 막습니다. 네트워크로 보내고 나서 서버가 거부하는 방식이 아니라 전송 자체를 사전에 차단합니다. 상한은 `packages/contracts`의 `MAX_UPLOAD_BYTES`입니다. (`apps/mobile/src/features/record-meeting/model/import-recording.ts`, `apps/mobile/src/features/request-transcription/model/request-transcription.ts`)
- **KEK가 맞지 않거나 암호문이 변조됐습니다.** 조회만 500으로 실패하고 저장된 행은 바뀌지 않습니다. (`services/ai-gateway/src/jobs/job-repository.ts`)

## 데이터 저장 위치

- 회의 메타데이터, 녹음 원본 파일, 재생·목록에 필요한 모든 정보는 기기 로컬 SQLite와 파일 영역에 남습니다. 이 데이터는 PC가 꺼져 있어도 유효합니다.
- job 상태, 전사 결과는 Supabase에 원본이 있고 앱은 polling으로 내려받아 로컬 SQLite에 복제해 둡니다. Supabase에는 전사 결과가 봉투 암호화 암호문으로 저장됩니다. 자세한 위치와 보호 범위는 [README.md의 데이터 위치와 보호](./README.md#데이터-위치와-보호)에 적습니다.
- 사용자 로그인 세션은 iOS Keychain·Android Keystore에 저장됩니다.

## 보안 경계

- Windows 업로드 수신기는 loopback(127.0.0.1)에만 bind하고 Tailscale Serve가 중계하는 요청만 받습니다. 외부나 사설망 전체에 직접 노출하지 않습니다. (`services/inference-worker/src/index.ts`)
- 업로드 허가(grant)는 HS256으로 서명된 JWT이고 1회만 쓸 수 있게 jti(토큰 고유 번호)를 기록해 재사용을 막습니다. (`services/inference-worker/src/uploads`)
- `/v1` Gateway API는 사용자 JWT 또는 Worker credential을 매 요청마다 검증합니다. (`services/ai-gateway/src/jobs/jobs-routes.ts`, `services/ai-gateway/src/jobs/worker-jobs-routes.ts`)
- Supabase의 `transcripts` 테이블은 RLS(행 단위 접근 규칙)를 켜 두고 쓰기는 `complete_job` RPC 하나로만 가능하게 권한을 좁혔습니다. (`services/ai-gateway/supabase/migrations/20260926125300_init.sql`)
- Supabase service role key, Worker credential, 전사문 KEK 같은 비밀 값은 모바일 앱 번들에 포함하지 않습니다.
- 전사문은 Gateway가 행마다 무작위 데이터 키(DEK)로 암호화하고 DEK는 다시 KEK로 암호화해 같은 행에 둡니다. KEK는 Gateway 실행 환경의 환경 변수(`TRANSCRIPT_KEK_B64`)에만 있고 Supabase·저장소·앱·Worker에는 두지 않습니다. (`services/ai-gateway/src/jobs/transcript-cipher.ts`)

## 모바일 FSD 구조

`apps/mobile/src`는 FSD(Feature-Sliced Design)를 따릅니다.

```text
app → pages → widgets → features → entities → shared
```

- `app` — Expo Router 라우트·전역 Provider
- `pages` — 화면 하나(예: `meeting-library`, `meeting-detail`)
- `widgets` — 여러 기능을 조합한 큰 UI 블록(예: `meeting-recorder`)
- `features` — 사용자 행동 단위(예: `record-meeting`, `request-transcription`)
- `entities` — 도메인 객체(예: `meeting`, `recording`, `transcript`)
- `shared` — 범용 UI·유틸·플랫폼 기반 코드, 도메인 용어 없음

의존 방향은 위에서 아래로만 흐르고 하위 계층은 상위 계층을 import하지 않습니다.
