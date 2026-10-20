# EchoNote 포트폴리오

회의를 녹음하고 개인 PC의 GPU로 전사하는 iOS·Android 앱입니다. 기획부터 검증까지 AI 코딩 도구와 함께 진행했습니다. 방향 결정·설계 승인·Android·iPhone 실기기 검증은 직접 판단했습니다.

시연 영상: (Release 링크 예정)

기능과 실행 방법은 [README](./README.md), 전체 구조는 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), 설계 결정은 [docs/DECISIONS.md](./docs/DECISIONS.md)에 있습니다.

## Problem

회의 녹음에는 사람 목소리가 그대로 담겨 있습니다. 상용 전사 서비스는 대부분 유료이거나 사용량 제한이 있고, 음성이 외부 클라우드에 올라갑니다. 그래서 다음 조건을 걸었습니다.

- 녹음 원본을 Vercel·Supabase 같은 클라우드에 두지 않습니다.
- 카드 등록이 필요 없는 무료 등급(Vercel Hobby, Supabase Free, Tailscale)만으로 운영합니다.
- PC가 꺼져 있어도 녹음·재생·목록·삭제는 동작합니다.
- iOS와 Android를 같은 코드로 만들고 두 플랫폼 실기기에서 검증합니다.

## Flow

```text
[앱: iOS·Android] --(작업 생성·상태 확인)--> [Vercel Gateway] <----> [Supabase: Auth·DB]
      |                                            ^
      | 녹음 파일은 Tailscale로 PC에 직접 전송       | 결과 전달 → Gateway가 잠가 저장
      v                                            |
[개인 PC(Windows): Worker + Whisper] ---------------
```

1. 앱에서 녹음하거나 기기의 m4a 파일을 고릅니다. 둘 다 같은 흐름으로 이어집니다.
2. 앱이 Gateway에 작업(job) 생성을 요청하고 Gateway는 짧은 수명의 업로드 허가(grant)를 발급합니다.
3. 앱이 허가를 들고 Tailscale로 PC에 파일을 직접 보냅니다. 이 경로는 Gateway를 거치지 않습니다.
4. Worker가 작업 점유권(lease)으로 대기 중인 job을 가져가 Docker 안의 Whisper(`large-v3-turbo`)로 전사합니다.
5. Gateway가 결과를 잠가 Supabase에 저장하고 job을 완료로 바꿉니다.
6. 앱이 상태를 주기적으로 확인해 완료되면 전사문을 내려받고, 문장을 누르면 그 문장의 시작 위치로 재생이 이동합니다.

백그라운드 녹음은 iOS·Android 모두 구현했습니다. 앱을 나가거나 화면을 꺼도 녹음이 계속됩니다.

## Data ownership

| 데이터              | 원본 위치                                | 비고                                                     |
| ------------------- | ---------------------------------------- | -------------------------------------------------------- |
| 녹음 원본·회의 정보 | 기기 로컬 파일 영역·SQLite               | PC가 꺼져 있어도 유효. 전사 요청 때만 PC로 전송          |
| 작업 상태·오류 코드 | Supabase `jobs`                          | 상태·오류 코드·크기·해시만 저장하고 본문은 없음          |
| 전사문              | Supabase `transcripts`(암호문) + 앱 사본 | Supabase엔 암호문, 앱엔 평문. 서버 원본과 앱 사본을 나눔 |
| 로그인 세션         | iOS Keychain·Android Keystore            | 앱 번들에는 비밀 값을 넣지 않음                          |
| 내보낸 m4a·txt      | 사용자가 OS 저장 화면에서 고른 위치      | 평문 사본이며 EchoNote가 보호하거나 지울 수 없음         |

서버 상태(`created`·`queued`·`processing`·`completed`·`failed`)는 Supabase가, 업로드 전 `LocalOnly` 같은 표시 상태는 앱이 각자 원본으로 가집니다. 업로드 진행과 서버 처리 단계가 한 값에 섞이지 않게 나눴습니다. (DECISIONS 6번)

회의(Meeting)와 녹음(Recording)은 같은 `meetingId`로 1:1이고, 한 트랜잭션에서 함께 만듭니다. 중간에 실패하면 둘 다 취소되어 한쪽만 남는 행(orphan)이 생기지 않습니다.

## Security boundary

- **녹음 원본은 클라우드에 가지 않습니다.** 서버(Gateway)는 "이 작업을 처리해도 된다"는 허가만 중계합니다.
- **PC 업로드 수신기는 loopback(127.0.0.1)에만 열고** Tailscale Serve가 중계하는 요청만 받습니다. 인터넷에 직접 공개하지 않습니다.
- **업로드 허가는 1회용입니다.** HS256 서명 JWT이고 jti(토큰 고유 번호)를 한 번만 소비해 재사용을 막습니다.
- **받은 파일은 검증한 뒤에만 확정합니다.** 임시 파일에 먼저 쓰고 길이·SHA-256·magic byte를 확인한 뒤 최종 경로로 옮깁니다.
- **전사문은 봉투 암호화로 저장합니다.** 행마다 다른 데이터 열쇠(DEK)로 AES-256-GCM 암호화하고, DEK는 열쇠용 열쇠(KEK)로 다시 잠가 같은 행에 둡니다. KEK는 Gateway 실행 환경에만 있고 Supabase·저장소·앱·Worker에는 없습니다. Supabase 단독 유출(콘솔·덤프·백업·SQL 주입)로는 전사문을 읽을 수 없습니다. (DECISIONS 8번)
- **`/v1` API는 요청마다** 사용자 JWT 또는 Worker credential을 검증하고, Supabase 테이블은 RLS(행 단위 접근 규칙)를 켜 둡니다.
- 전사·녹음 본문은 Vercel·Supabase 로그에 남기지 않습니다.

## Failure recovery

| 상황                  | 동작                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PC가 꺼져 있음        | 업로드 전에 `/live`로 확인하고 5초 안에 응답이 없으면 안내를 보여줌. 녹음·재생·목록은 계속 동작                        |
| 업로드 중 연결이 끊김 | 검증 전 임시 파일은 지워지고 job은 `created`로 남음. 새 허가로 다시 보내면 됨                                          |
| Worker가 전사 중 죽음 | lease가 5분 뒤 만료되고 다음 claim이 그 job을 처음부터 다시 가져감. 3회 시도해도 끝나지 않으면 DB가 실패로 확정        |
| 결과 저장 실패        | 상태 변경과 결과 저장이 한 트랜잭션(`complete_job`)이라 함께 되돌려짐. job은 `processing`으로 남아 다시 완료 시도 가능 |
| 옛 lease의 늦은 요청  | lease_id 불일치로 거부되어 두 Worker가 같은 job을 동시에 완료하지 못함                                                 |
| 512 MiB 초과 파일     | 앱이 전송 전에 막음                                                                                                    |
| 전사 실패             | 이유를 6종 코드로 고정해 코드별 문구로 안내하고 다시 요청할 수 있음 (DECISIONS 5번)                                    |

## Known limits

- **회의 목록은 앱에 등록한 시각(`createdAt`) 최신순입니다.** 녹음이 실제로 시작된 시각은 저장하지 않아서, 나중에 가져온 녹음 파일은 실제 녹음 시점과 상관없이 등록 시각에 놓입니다.
- **Meeting과 Recording은 1:1로 한 트랜잭션에서 만듭니다.** 한 회의에 녹음 여러 개를 붙이는 구조가 아닙니다.
- 업로드·전사는 개인 Tailscale 네트워크 전용이라 외부인이 직접 체험할 수 없습니다. 그래서 영상과 문서로 보여 드립니다.
- 업로드 중 앱이 백그라운드로 가면 전송을 멈추고 "텍스트 변환 요청이 끝나지 않았습니다" 상태로 남겨 다시 요청하게 합니다. 이어 올리기·백그라운드 업로드는 없습니다.
- iOS는 유료 개발자 계정 없이 개인 개발 빌드로만 설치합니다.
- 운영자(KEK 보유자)는 전사문을 복호화할 수 있고, KEK를 잃으면 서버의 전사문은 복구할 수 없습니다.
- 구현하지 않은 것: 전사문 수정(revision), 요약, Electron 데스크탑 앱(보류). 성과로 주장하지 않습니다.

## Evidence

### Reproduce

```bash
nvm install
corepack enable
pnpm install
pnpm verify   # format·lint·typecheck·test·build
```

실기기 E2E 실행법은 `apps/mobile/e2e/maestro/README.md`에 있습니다. 전사 경로 전체는 Windows(Docker Desktop, NVIDIA GPU)와 Tailscale이 필요해 외부에서 그대로 재현할 수 없습니다.

### Verification

| 항목                   | 결과                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `pnpm verify`          | 통과                                                                               |
| 자동 테스트            | 1,458건(mobile 806, inference-worker 311, ai-gateway 248, contracts 91, desktop 2) |
| 실기기 E2E(Maestro)    | flow 11개, Android 실기기 11/11, iPhone 실기기 11/11(maestro-runner)               |
| Android 녹음 품질 개선 | 1 m 전사 오류율(CER) 회차별 23–100 % → 15.9 %                                      |

Android 녹음 품질은 원인을 끝까지 추적했습니다. 녹음 입력을 통화용(`VOICE_COMMUNICATION`)으로 열어 말 없는 구간과 작은 말소리가 완전 무음(0)으로 지워지고 있었습니다. 10 ms 단위 무음 비율이 1 m에서 47–70 %, 3 m에서 95–98 %였고 기본 녹음 앱과 iPhone은 0.1 % 이하였습니다. 입력을 일반 마이크(`MIC`)로 바꾸고 증폭을 +11 dB에서 +37 dB로 올려 해결했습니다. 3 m는 기기 마이크 감도 차이로 개선이 부족해 범위 밖으로 두었습니다. 다른 사례는 README의 트러블슈팅에 있습니다.

## Resume bullet

백그라운드 녹음을 지원하는 iOS·Android 회의 전사 앱을 Expo React Native, Fastify·Supabase, Tailscale 직접 전송, 전사문 봉투 암호화(AES-256-GCM)로 구축했습니다. 기획부터 검증까지 AI 코딩 도구와 함께 진행하며 방향 결정·설계 승인·Android·iPhone 실기기 검증은 직접 판단했고, 자동 테스트 1,458건과 Android·iPhone 실기기 E2E 각 11/11로 확인했습니다.
