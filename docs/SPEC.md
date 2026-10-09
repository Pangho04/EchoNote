# SPEC

EchoNote 첫 버전의 동작 명세입니다. 구성 요소와 흐름 그림은 [ARCHITECTURE.md](./ARCHITECTURE.md), 결정 근거는 [DECISIONS.md](./DECISIONS.md)에 적습니다.

## 용어

**서버 구성**

| 용어          | 뜻                                                             |
| ------------- | -------------------------------------------------------------- |
| Gateway       | Vercel에서 도는 제어 API 서버입니다.                           |
| Worker        | 전사 PC에서 전사를 실행하는 상시 프로세스입니다.               |
| Fastify       | Node.js용 웹 서버 프레임워크입니다.                            |
| Docker        | 실행 환경을 컨테이너로 묶어 어디서나 같게 실행하는 도구입니다. |
| 업로드 수신기 | 전사 PC에서 Worker가 녹음 파일을 받는 HTTP 서버입니다.         |

**작업**

| 용어            | 뜻                                                                  |
| --------------- | ------------------------------------------------------------------- |
| job             | 전사 요청 1건입니다.                                                |
| claim           | Worker가 대기 job을 가져가는 요청입니다.                            |
| lease           | 작업 점유권으로, Worker가 job을 붙잡고 있는 기한입니다.             |
| segment         | 전사 문장 1개와 시작·끝 시각입니다.                                 |
| manifest        | 업로드 완료를 기록해 두는 파일입니다.                               |
| polling         | 서버 상태를 일정 간격으로 반복해 확인하는 방식입니다.               |
| foreground      | 앱이 화면 앞에 있는 상태입니다.                                     |
| background      | 앱이 화면 앞에 있지 않은 상태입니다.                                |
| keep awake      | 화면이 꺼지지 않게 막는 기능입니다.                                 |
| heartbeat       | 작업을 계속 처리 중이라고 주기적으로 알리는 신호입니다.             |
| Idempotency-Key | 같은 요청을 중복 실행해도 한 번만 처리하게 막는 헤더(멱등키)입니다. |

**인증**

| 용어             | 뜻                                              |
| ---------------- | ----------------------------------------------- |
| JWT              | 서명된 로그인·허가 토큰입니다.                  |
| Bearer           | HTTP 인증 헤더에 토큰을 실어 보내는 방식입니다. |
| RLS              | 행 단위 접근 제어입니다.                        |
| service role     | RLS를 건너뛰는 서버 전용 DB 권한입니다.         |
| jti              | 토큰마다 붙는 1회용 고유 번호입니다.            |
| WWW-Authenticate | 인증 방식을 알려 주는 HTTP 응답 헤더입니다.     |

**저장**

| 용어        | 뜻                                                                                |
| ----------- | --------------------------------------------------------------------------------- |
| SQLite      | 기기에 파일로 저장하는 가벼운 관계형 데이터베이스입니다.                          |
| base64      | 이진 데이터를 글자로 옮겨 적는 표기 방식입니다.                                   |
| SHA-256     | 파일 내용으로 만든 64자리 16진수(hex) 지문이고, 내용이 1바이트만 달라도 바뀝니다. |
| magic byte  | 파일 맨 앞의 형식 표지 바이트입니다.                                              |
| DEK         | 데이터를 직접 암호화하는 열쇠(data encryption key)입니다.                         |
| KEK         | DEK를 다시 감싸 보관하는 상위 열쇠(key encryption key)입니다.                     |
| RPC         | 데이터베이스 안에서 실행하는 함수 호출(remote procedure call)입니다.              |
| transaction | 여러 작업을 한 번에 전부 반영하거나 전부 취소하는 DB 작업 묶음입니다.             |
| iv          | 암호화마다 새로 만드는 초기값입니다.                                              |
| 인증 태그   | 변조 여부를 확인하는 값입니다.                                                    |

**네트워크**

| 용어            | 뜻                                                               |
| --------------- | ---------------------------------------------------------------- |
| Tailscale Serve | Tailscale 네트워크 안에서만 로컬 포트를 HTTPS로 여는 기능입니다. |
| loopback        | 같은 기기 안에서만 통하는 주소(127.0.0.1)입니다.                 |

**기타**

| 용어                      | 뜻                                                                |
| ------------------------- | ----------------------------------------------------------------- |
| UUID                      | 겹치지 않게 무작위로 만든 128비트 식별자입니다.                   |
| beam size                 | 전사 모델이 동시에 비교하는 후보 문장 수입니다.                   |
| float16                   | GPU 계산에 쓰는 16비트 숫자 정밀도입니다.                         |
| VAD                       | 음성이 있는 구간만 골라내는 기술(voice activity detection)입니다. |
| MiB                       | 용량 단위입니다(1 MiB = 1,048,576바이트).                         |
| UTC ISO                   | 국제 표준시 기준 ISO 8601 날짜·시각 문자열입니다.                 |
| `Cache-Control: no-store` | 응답을 캐시에 저장하지 말라는 HTTP 헤더입니다.                    |
| content-type              | 본문 형식을 알리는 HTTP 헤더입니다.                               |
| CLI                       | 명령줄 도구입니다.                                                |
| faster-whisper            | Whisper 음성 인식 모델을 빠르게 돌리는 라이브러리입니다.          |

## 한도와 수치

### 파일·전사 결과

| 항목                        | 값                         |
| --------------------------- | -------------------------- |
| 업로드 최대 크기            | 536,870,912바이트(512 MiB) |
| 허용 MIME(파일 형식 이름)   | `audio/mp4`(m4a)           |
| 전사 결과 최대 길이         | 6시간                      |
| 전사 결과 segment 최대 개수 | 20,000개                   |
| segment 텍스트 최대 길이    | 2,000자                    |

### 업로드 허가

| 항목                                | 값                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| 업로드 허가(upload grant) 유효 시간 | 300초                                                                                 |
| Worker 시계 오차 허용               | 30초                                                                                  |
| 업로드 허가 jti 기록 보관           | Worker가 시작할 때 만료 뒤 1시간이 지난 기록을 지웁니다. 실행 중에는 지우지 않습니다. |

### Worker

| 항목                                | 값                                               |
| ----------------------------------- | ------------------------------------------------ |
| 작업 점유권(lease) 유효 시간        | 5분                                              |
| Worker 자체 중단 기한               | 270초                                            |
| 작업 claim 최대 횟수                | 3회                                              |
| Worker heartbeat(점유권 연장) 간격  | 60초                                             |
| 대기 job 없을 때 다음 조회까지 대기 | 60초                                             |
| Worker 동시 처리 기본·최대          | 3                                                |
| 전사 1건 컨테이너 실행 상한         | 60분                                             |
| 완료 요청 본문 상한                 | 4 MiB(Vercel 본문 상한 4.5 MB(Vercel 표기) 아래) |

마지막 점유권 연장 요청을 보낸 뒤 270초가 지나면 Worker가 스스로 그 job 처리를 멈춥니다. 점유권(5분)이 만료되기 전에 멈추려는 것입니다.

### 앱

| 항목                            | 값     |
| ------------------------------- | ------ |
| job 상태 확인(polling) 간격     | 5초    |
| 전사 PC 준비 확인 시간 초과     | 5초    |
| 전사 결과 다운로드 시간 초과    | 30초   |
| 회의 제목 길이                  | 1~80자 |
| 목록 한 번에 불러오는 개수      | 20개   |
| 재생 앞·뒤 이동 단위            | 10초   |
| Gateway 요청 기본 시간 초과     | 10초   |
| 가져온 파일 길이 읽기 시간 초과 | 10초   |

## 모바일 화면

F 번호는 PRD의 기능 번호입니다.

- `/`(회의 목록) — F2, F3
- `/meetings/:meetingId`(회의 상세, 녹음 직후는 `?autoRequest=1`로 자동 변환 1회) — F4, F5, F6, F7, F8
- `/recording?meetingId=…`(녹음) — F1
- `/sign-in`(로그인) — F9

- 회의 기본 제목 형식은 `YYYY-MM-DD 오전/오후 hh:mm:ss_녹음`(기기 시간대 기준)입니다.
- 전사 시각은 화면에서 1시간 미만 `m:ss`, 1시간 이상 `h:mm:ss`로 표기합니다.

## 전사 요청 흐름(앱 기준)

1. 녹음 검사: 512 MiB를 넘거나 `audio/mp4`가 아니면 job을 만들지 않고 「512MB 이하의 m4a 녹음만 텍스트로 변환할 수 있습니다.」를 보여줍니다.
2. `POST /v1/jobs`로 job을 생성합니다.
   - 요청 헤더 `Idempotency-Key`에 UUID를 담습니다.
   - 같은 키로 같은 내용을 다시 보내면 200과 기존 job을 받습니다. 키는 같은데 `meetingId`·`sizeBytes`·`sha256`·`mimeType` 중 하나라도 다르면 409 `idempotency_conflict`입니다.
   - 앱은 [텍스트로 변환]·[다시 시도]를 누를 때마다 새 키를 만듭니다.
   - 앱 SQLite `meeting_transcriptions`에 job_id와 `created`를 저장합니다.
3. `POST /v1/jobs/:jobId/upload-grants`로 업로드 허가를 받습니다.
   - 409 `job_not_uploadable`이면 이미 업로드된 것으로 봅니다.
   - 404면 로컬 행을 지웁니다.
4. 허가 응답의 `uploadUrl`과 같은 호스트(origin)에서 업로드 수신기의 `GET /live`를 호출해 준비 상태를 확인합니다. 5초 안에 204가 아니면 전사 PC 꺼짐으로 봅니다.
5. 화면이 열려 있고 앱이 foreground일 때만 `PUT /uploads`로 녹음을 전송합니다.
   - 업로드 중에는 화면 꺼짐을 방지합니다(keep awake).
   - 성공은 200·201입니다.
   - 422면 앱이 그 job의 로컬 전사 행을 지우고 「녹음 파일을 확인할 수 없습니다」를 보여줍니다.
   - 그 밖은 전송 실패로 봅니다.
   - 허가 요청(3단계)이나 전송이 실패하면 로컬 행은 created로 남습니다. 「텍스트 변환 요청 실패」 알림을 띄우고, 같은 제목의 상자와 [다시 요청]을 보여줍니다.
   - 업로드 중 앱이 background로 가면 전송을 중단합니다. 로컬 행은 created로 남고 「텍스트 변환 요청이 끝나지 않았습니다」 상자와 [다시 요청]을 보여줍니다.
6. 상태를 확인합니다(polling).
   - 상세 화면: job이 queued·processing이고 앱이 foreground일 때만 5초마다 `GET /v1/jobs/:jobId`로 확인합니다.
   - 1회 즉시 확인하는 때는 다음입니다.
     - 화면 진입 때(로컬 행이 created·queued·processing)
     - 업로드 직후
     - polling 중 background에서 돌아올 때
   - 목록 화면: 화면에 포커스가 있고 foreground이며 불러온 페이지에 queued·processing 회의가 있을 때만 5초마다 확인합니다.
   - created는 5초 반복 확인 대상이 아닙니다(화면 진입 때 1회 확인만 합니다).
   - completed면 `GET /v1/jobs/:jobId/transcript`로 결과를 받아 SQLite에 저장합니다.

| 버튼                            | 보이는 상태                | 시작 단계             |
| ------------------------------- | -------------------------- | --------------------- |
| [다시 요청]                     | 요청 미완료(`created`)     | 새 job 없이 3단계부터 |
| 전사 PC 꺼짐 안내의 [다시 확인] | 전사 PC 꺼짐 안내 팝업     | 새 job 없이 3단계부터 |
| [텍스트로 변환]                 | 전사를 요청한 적 없는 회의 | 새 job부터            |
| [다시 시도]                     | 실패(`failed`)             | 새 job부터            |

## Gateway API

사용자 경로는 `Authorization: Bearer <Supabase 사용자 JWT>`, Worker 경로(`/v1/worker/…`)는 `Authorization: Bearer <Worker API 토큰>`을 씁니다. 두 인증은 서로의 경로를 열지 못합니다.

- 이 표의 오류 본문은 `{ "error": "<코드>" }`입니다.
- 단 413(본문 크기 초과)과 없는 경로의 404는 예외입니다.
  - 413은 Fastify 기본 오류 본문 `{ statusCode, code, error, message }`로 나갑니다.
  - 404는 `{ statusCode, error, message }`로 나갑니다.
  - 이때(413·404 모두) `error`는 HTTP 사유 문구입니다.

| 상황                                                         | HTTP                            | error                                   |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------- |
| 인증 실패                                                    | 401(`WWW-Authenticate: Bearer`) | `unauthorized`                          |
| 토큰 검증기 장애                                             | 503                             | `auth_unavailable`                      |
| 저장소 일시 장애                                             | 503                             | `job_store_unavailable`                 |
| 본문 파싱 실패                                               | 400                             | `invalid_request`                       |
| 미지원 content-type                                          | 400                             | `invalid_request`                       |
| 경로 매개변수 오류(jobId가 UUID 아님)                        | 400                             | `invalid_request`                       |
| 본문 스키마 위반(예: 전사 6시간 초과, segment 20,000개 초과) | 400                             | `invalid_request`                       |
| 그 밖 서버 오류                                              | 500                             | `internal`(원인은 응답에 담지 않습니다) |

### `GET /live`

- 인증: 없음
- 요청: 없음
- 성공: 200 `{service:"echonote-ai-gateway", status:"live"}`
- 실패: 없음

### `POST /v1/jobs`

- 인증: 사용자
- 요청: 헤더 `Idempotency-Key`(UUID), 본문 `{meetingId(uuid), sizeBytes(1~536870912 정수), sha256(소문자 hex 64자), mimeType:"audio/mp4"}`(정의 안 된 필드 거부)
- 성공: 201 새 job 또는 200 같은 키로 이미 만든 job(필드: id, meetingId, status, sizeBytes, sha256, mimeType, createdAt(UTC ISO))
- 실패:
  - 409 `idempotency_conflict`(같은 키, 다른 내용)
  - 400 `invalid_request`

### `GET /v1/jobs/:jobId`

- 인증: 사용자
- 요청: 없음
- 성공: 200 `{id, meetingId, status, errorCode}`(errorCode는 failed일 때만 값, `Cache-Control: no-store`)
- 실패:
  - 404 `job_not_found`(다른 사용자 job도 404)
  - 400 `invalid_request`(jobId 형식 오류)

### `GET /v1/jobs/:jobId/transcript`

- 인증: 사용자
- 요청: 없음
- 성공: 200 `{jobId, durationMs, segments[{startMs,endMs,text}]}`(`Cache-Control: no-store`, Gateway가 복호화해 돌려줌)
- 실패:
  - 404 `transcript_not_found`(완료 전에도 404)
  - 500 `internal`(KEK 불일치·암호문 변조, 저장된 행은 바뀌지 않음)
  - 400 `invalid_request`(jobId 형식 오류)

### `POST /v1/jobs/:jobId/upload-grants`

- 인증: 사용자
- 요청: 본문 없음(있으면 400)
- 성공: 200 `{uploadUrl, grant, expiresAt}`(`Cache-Control: no-store`)
- 실패:
  - 404 `job_not_found`
  - 409 `job_not_uploadable`(status가 created가 아님)
  - 400 `invalid_request`(jobId 형식 오류)

### `GET /v1/auth-check`

- 인증: 사용자
- 요청: 없음
- 성공: 200 `{userId}`, 연결 진단용
- 실패: 없음

### `POST /v1/worker/upload-completions`

- 인증: Worker
- 요청: `{jobId, ownerId, sizeBytes, sha256, mimeType}`
- 성공: 201 job을 queued로 또는 200 이미 반영
- 실패:
  - 409 `upload_completion_conflict`
  - 404 `job_not_found`
  - 400 `invalid_request`(본문 스키마 위반)

### `POST /v1/worker/jobs/claim`

- 인증: Worker
- 요청: 없음
- 성공: 200 `{job:{id, meetingId, status, sizeBytes, sha256, mimeType, createdAt}, lease:{leaseId, expiresAt}}`
- 가져갈 job 없음: 204(오류가 아닙니다)

### `POST /v1/worker/jobs/:jobId/lease`

- 인증: Worker
- 요청: `{leaseId}`
- 성공: 200 `{expiresAt}`
- 실패:
  - 409 `lease_stale`(점유권을 잃음, 처리 중단)
  - 400 `invalid_request`(jobId 형식 오류·본문 스키마 위반)

### `POST /v1/worker/jobs/:jobId/fail`

- 인증: Worker
- 요청: `{leaseId, errorCode}`(`attempts_exhausted` 제외 [5종](#전사-실패-코드-6종))
- 성공: 204
- 실패:
  - 409 `lease_stale`
  - 400 `invalid_request`(jobId 형식 오류·본문 스키마 위반)

### `POST /v1/worker/jobs/:jobId/complete`

- 인증: Worker
- 요청: `{leaseId, transcript:{durationMs, segments}}`, 본문 상한 4 MiB(넘으면 413)
- 성공: 204(Gateway가 전사문을 봉투 암호화해 저장하고 job을 completed로 바꿈)
- 실패:
  - 409 `lease_stale`
  - 400 `invalid_request`(jobId 형식 오류·본문 스키마 위반)
- Worker는 400·413을 받으면 그 job을 `result_rejected`로 실패 처리합니다(예: 전사 6시간 초과).
- 그 밖 오류면 job은 processing으로 남습니다. 점유권이 끝난 뒤 다시 가져가 처음부터 전사합니다.

### `GET /ready`

- 첫 버전은 준비 상태를 점검하지 않으며 항상 503을 돌려줍니다.
- 본문은 `{ "status": "not_ready", "checks": { "llm": "not_configured", "stt": "not_configured" } }`입니다.

## 업로드 허가(upload grant)

- HS256(공유 비밀값 서명 방식)으로 서명한 JWT입니다.
- Gateway와 Worker가 같은 비밀값(`UPLOAD_GRANT_SECRET_B64`, 32바이트 이상)을 나눠 가집니다.
- 파일 정보는 요청 본문이 아니라 저장된 job 행에서만 옵니다.

| JWT 항목     | 값                         |
| ------------ | -------------------------- |
| `iss`        | `echonote-ai-gateway`      |
| `aud`        | `echonote-upload-receiver` |
| `sub`        | 사용자 id                  |
| `jti`        | 1회용 고유 번호            |
| `iat`        | 발급 시각(`nbf`와 같음)    |
| `nbf`        | `iat`와 같음               |
| `exp`        | `iat`+300                  |
| `job_id`     | job id                     |
| `size_bytes` | 파일 크기                  |
| `sha256`     | 파일 SHA-256               |
| `mime_type`  | 파일 MIME                  |

검사 순서는 [업로드 수신기 API](#업로드-수신기-api)의 검사 순서 표를 따릅니다.

## 업로드 수신기 API

전사 PC의 Worker가 여는 HTTP 서버입니다. loopback(127.0.0.1)에만 바인딩하고 Tailscale Serve(HTTPS)로만 노출됩니다.

### `GET /live`

204를 돌려줍니다.

### `PUT /uploads`

- 요청 헤더: `Authorization: Bearer <업로드 허가>`, `Content-Type: application/octet-stream`, `Content-Length`(허가의 크기와 같아야 함)
- 요청 본문: 녹음 바이트
- 성공: 201 `{jobId}`(새로 반영) 또는 200 `{jobId}`(이미 반영)
- 허가는 content-type 검사(415)와 서명·만료 검사(401)를 통과한 직후 소비됩니다. 그 뒤 `Content-Length` 불일치(400)나 수신 검사 실패로 끝나도 같은 허가는 다시 쓸 수 없습니다(409 `upload_grant_used`).

| HTTP | error                        | 뜻                                                                           | 검사 순서 |
| ---- | ---------------------------- | ---------------------------------------------------------------------------- | --------- |
| 415  | `unsupported_media_type`     | content-type이 `application/octet-stream`이 아닙니다.                        | 1         |
| 401  | `invalid_upload_grant`       | 서명·만료·JWT 항목 검사 실패입니다.                                          | 2         |
| 409  | `upload_grant_used`          | 이미 쓴 허가입니다.                                                          | 3         |
| 400  | `invalid_request`            | `Content-Length`가 허가의 크기와 다릅니다.                                   | 4         |
| 422  | `upload_verification_failed` | 크기·SHA-256·magic byte(위치(오프셋) 4의 고정 시그니처 `ftyp`) 불일치입니다. | 5         |
| 502  | `upload_completion_failed`   | Gateway 통지 실패입니다.                                                     | 6         |
| 500  | `internal`                   | 그 밖 서버 오류입니다.                                                       | -         |

422 단계에서 허가와 비교하는 값은 크기·SHA-256뿐입니다.

- 502는 통지가 네트워크 오류·시간 초과·Gateway 5xx로 실패했을 때만 발생합니다. 같은 job으로 새 허가를 받아 다시 보내면 풀립니다.
- Worker에 남긴 완료 기록(manifest) 손상·불일치, Gateway의 401·409 거절, 그 밖 4xx·3xx 응답은 다시 보내도 풀리지 않습니다.

수신 검사: 임시 파일에 받은 뒤 검사를 모두 통과할 때만 최종 파일로 확정하고 Gateway `upload-completions`에 통지합니다. 임시 파일은 성공·실패와 관계없이 지웁니다.

## 전사 실패 코드 6종

[DECISIONS.md 5번](./DECISIONS.md#5-전사-실패-이유를-6종-코드로-고정해-보여준다)에 코드를 고정한 근거가 있습니다.

| 코드                 | 누가 기록                                    | 앱 문구                                                                                 |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `audio_missing`      | Worker                                       | 「데스크탑에서 녹음 파일을 찾지 못했습니다.」                                           |
| `stt_unavailable`    | Worker                                       | 「데스크탑의 음성 인식이 꺼져 있습니다.」                                               |
| `stt_failed`         | Worker                                       | 「음성 인식 중 문제가 생겼습니다.」                                                     |
| `result_rejected`    | Worker                                       | 「변환 결과가 올바르지 않습니다.」                                                      |
| `attempts_exhausted` | DB(claim 때, 3회 잡혔는데 점유권이 끝난 job) | 「여러 번 시도했지만 변환하지 못했습니다.」                                             |
| `unexpected`         | Worker                                       | 「알 수 없는 문제로 변환하지 못했습니다.」(서버가 이유 없이 실패를 남긴 경우도 이 문구) |

## 데이터 모델

- Supabase `jobs`, `transcripts` 테이블은 둘 다 RLS를 켜고 정책(policy)은 두지 않습니다.
- 앱(클라이언트) 역할은 접근할 수 없고 Gateway의 service role만 접근합니다.

### `jobs`

| 열                          | 뜻·제약                           |
| --------------------------- | --------------------------------- |
| id                          | uuid                              |
| owner_id                    | 사용자. 계정이 지워지면 함께 삭제 |
| meeting_id                  | 회의 id                           |
| size_bytes                  | 1~536870912                       |
| sha256                      | 파일 SHA-256                      |
| mime_type                   | `audio/mp4`                       |
| status                      | 5종(아래 표)                      |
| idempotency_key             | 사용자별 유일                     |
| created_at                  | 생성 시각                         |
| lease_id · lease_expires_at | processing일 때만 값              |
| attempt_count               | claim 횟수                        |
| error_code                  | failed일 때만, 6종                |
| claimed_at                  | 마지막 claim 시각                 |

### `transcripts`

| 열              | 뜻·제약                             |
| --------------- | ----------------------------------- |
| job_id          | jobs와 1:1                          |
| owner_id        | 사용자                              |
| duration_ms     | 전사 길이(ms)                       |
| segments_sealed | 암호화한 segment 목록, base64       |
| dek_sealed      | KEK로 감싼 데이터 열쇠, base64 80자 |
| key_version     | 암호화 열쇠 버전(첫 버전은 1)       |
| created_at      | 생성 시각                           |

전사 본문(segment)은 암호문 열에만 있습니다. `duration_ms`와 암호문 길이는 평문 메타데이터로 남습니다. 쓰기는 `complete_job` RPC로만 가능합니다.

### job status 5종

| status       | 뜻                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `created`    | Gateway가 작업을 만들었고 업로드가 확인되기 전 상태.                                                                       |
| `queued`     | 업로드가 확인되어 Worker가 가져갈 수 있는 상태.                                                                            |
| `processing` | Worker가 lease를 쥐고 전사를 실행 중인 상태.                                                                               |
| `completed`  | 결과가 저장되고 더는 바뀌지 않는 상태.                                                                                     |
| `failed`     | 처리 오류로 끝났거나, 3회 가져간 job의 lease가 만료된 뒤 다음 claim 때 실패로 확정된 상태. `error_code`에 원인이 남습니다. |

RPC(모두 service role만 실행):

| RPC               | 하는 일                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `create_job`      | job 생성, 멱등키 중복 처리 포함                                            |
| `complete_upload` | 업로드 완료 통지를 받아 job을 queued로                                     |
| `claim_job`       | 가져갈 job을 골라 lease 발급                                               |
| `renew_job_lease` | lease 만료 시각 연장                                                       |
| `fail_job`        | lease 확인 후 job을 failed로                                               |
| `complete_job`    | lease 확인 후 job을 completed로 바꾸고 전사 결과를 같은 transaction에 저장 |

- `claim_job` 순서: 멈춘 Worker의 job(점유권 만료된 processing)을 먼저 되찾고 그다음 가장 오래 처리받지 못한 사용자의 가장 오래된 queued job을 가져갑니다. 근거는 [DECISIONS.md 7번](./DECISIONS.md#7-사용자별로-공정하게-작업을-가져가는-순서를-만든다)에 있습니다.
- 점유권이 만료된 job은 다음 claim 때까지 processing으로 남습니다.
- 상태 전이는 [ARCHITECTURE.md의 작업 상태 전이](./ARCHITECTURE.md#작업-상태-전이)에 적습니다.

### 앱 SQLite

- `meetings` — id, title(1~80자), created_at_ms, updated_at_ms
- `recordings` — meeting_id와 1:1, relative_path(문서 폴더 기준 상대 경로), mime_type, sha256, duration_ms, byte_size(>0). 회의 삭제 시 함께 삭제됩니다.
- `meeting_transcriptions` — meeting_id당 최신 시도 1행, job_id, status(5종), error_code, duration_ms, segments_json(본문은 completed일 때만). 회의 삭제 시 함께 삭제됩니다.

## 전사문 암호화

봉투 암호화(envelope encryption)입니다.

1. 행마다 무작위 32바이트 데이터 열쇠(DEK)로 segment 목록을 AES-256-GCM(변조되면 복호화가 실패하는 표준 암호 방식, iv 12바이트·인증 태그 16바이트)으로 잠급니다.
2. DEK는 다시 열쇠용 열쇠(KEK, `TRANSCRIPT_KEK_B64`)로 AES-256-GCM으로 잠가 같은 행에 둡니다.
3. 추가 인증 데이터(aad)에 job_id·key_version·용도(segment 목록용/DEK용)를 넣어 다른 행의 암호문으로 바꿔치기하면 복호화가 실패합니다.

KEK는 Gateway 실행 환경 변수(`TRANSCRIPT_KEK_B64`)에만 두고 Supabase·코드 저장소(git)·앱·Worker에는 두지 않습니다.

KEK 보관 위치의 근거는 [DECISIONS.md 8번](./DECISIONS.md#8-전사문을-gateway가-봉투-암호화해-저장한다)에 있습니다. KEK 회전 절차는 다음 버전 후보입니다.

## 전사 엔진

- Worker가 Docker CLI를 `execFile`(별도 프로세스를 실행하는 Node.js 함수)로 실행합니다.
- 컨테이너는 `nvidia/cuda` 기반이며 faster-whisper를 씁니다.
- 모델은 `large-v3-turbo`로 전사합니다.

설정:

- 언어 `ko`
- beam size 5
- 음성 구간 검출(VAD) 켬
- GPU float16

## 내보내기

- 파일 이름은 회의 제목에서 금지 문자(`/ \ : * ? " < > |`)·제어 문자·짝 없는 서로게이트(깨진 글자 조각)를 `_`로 바꾸고, 앞뒤 공백·마침표를 지운 것(비면 `echonote`) + `.txt`/`.m4a`입니다.
- 텍스트 본문은 문장 안 공백을 하나로 줄이고 빈 문장은 빼며 각 줄은 `[시각] 문장`입니다.
- 내보낸 텍스트는 분을 두 자리로 채워 `[mm:ss]`(1시간 이상 `[h:mm:ss]`)로 적습니다.
- 앱 캐시에 임시 사본을 만들어 OS 저장 화면에 넘기고 OS 저장 화면이 닫히면 지웁니다.
- 내보내기는 한 번에 하나만 실행됩니다.
- OS 저장 화면은 앱에 포함한 로컬 Expo 모듈(Swift·Kotlin)로 띄웁니다.

**주의**: 저장된 파일은 평문 사본이고 EchoNote가 보호·삭제할 수 없습니다.

## 플랫폼 요구

- iOS·Android 실기기에서 동작해야 합니다.
- 마이크 권한이 있어야 합니다.
  - 거부 시 「마이크 권한을 허용해야 녹음을 시작할 수 있습니다.」를 보여줍니다.
  - 차단 시 설정 열기를 안내합니다.
- 전사·업로드는 기기에 Tailscale 연결이 필요합니다.
- Worker는 NVIDIA GPU가 있는 전사 PC와 Docker가 필요합니다.
- iOS는 무료 개인 개발 서명이라 7일마다 다시 설치해야 합니다.
- Gateway 배포 하나는 업로드 수신기 주소 하나(`WORKER_RECEIVER_BASE_URL`)만 씁니다.
- 그래서 Gateway 배포 하나당 전사 PC는 1대입니다.
