# BACKLOG

아직 하지 않기로 한 일을 적습니다. 항목마다 왜 미뤘는지, 코드 어디를 건드리는지, 언제 시작하는지를 둡니다. 끝난 항목은 지웁니다(이력은 git).

설계 카드를 쓰기 전에 이 파일을 읽고, 겹치는 항목이 있으면 카드에 번호를 적습니다.

## 1. `use-transcription.ts` 책임 분리 — 중

**배경** — `apps/mobile/src/features/request-transcription/model/use-transcription.ts`가 843행이고 컨트롤러 안에 내부 함수 25개가 있습니다. 업로드·polling·행 정합·AppState·알림·Worker 꺼짐 안내가 한 클로저에 있습니다. 「서버 job 결과를 SQLite 행에 반영」하는 규칙이 `handleJob`(364행)과 `sync-pending-transcriptions.ts`의 `syncTranscription`에 두 벌 있어 상태가 하나 늘면 두 곳을 고쳐야 합니다.

**방향** — ① 반영 규칙을 순수 함수 하나로 빼서 상세·목록이 같이 씁니다. ② 업로드 절차(`finishUpload` 578행·`runUpload` 652행·`showDesktopOffline`)를 별 파일로 옮깁니다. ③ 컨트롤러는 화면 상태(panel)와 타이머만 남깁니다. 기존 테스트가 그대로 통과해야 합니다.

**착수 조건** — Gate C 공개 뒤. E2E 암호화를 착수한다면 같은 파일을 건드리므로 그때 순서를 정합니다.

## 2. 진행 중 회의 묶음 조회 API — 소

**배경** — 목록 화면은 대기·변환 중 회의를 5초마다 한 건씩 순차 조회합니다(`sync-pending-transcriptions.ts:84` `ponytail:` 주석). 진행 중 회의가 많아지면 회차 하나가 5초를 넘깁니다.

**방향** — Gateway에 `GET /v1/jobs?ids=…` 하나를 두고 앱은 한 번에 묻습니다. 계약은 `packages/contracts`에 추가합니다.

**착수 조건** — 진행 중 회의가 3건 이상인 상황이 실제로 생길 때. 그 전엔 하지 않습니다.

## 3. 다수 사용자 서비스 전환 시 고지 의무 — 중

**배경** — 지금은 빌드한 사람이 자기 Gateway·Supabase를 띄우는 구조라 운영자=사용자입니다. 한 운영자가 남의 데이터를 맡는 순간 개인정보 보호법상 처리방침, 국외 이전 고지(제28조의8 — Supabase 리전이 해외일 때 이전 항목·국가·수탁자·보유 기간 공개), 보관 기간이 필요합니다.

**방향** — 앱 안 첫 전사 요청 때 저장 위치 안내 팝업 1회(`useDialog`). 처리방침 페이지와 보관 기간 자동 삭제는 서비스 전환을 결정할 때 설계합니다.

**함께 볼 것** — Supabase 프로젝트 리전이 `ap-south-1`(인도 뭄바이), Vercel 함수 기본 리전이 미국이라 전환 시 국외 이전 항목에 둘 다 적거나 서울로 옮깁니다(Supabase는 새 프로젝트로 이전, Vercel은 `vercel.json`의 `regions: ["icn1"]`). 운영자도 전사문을 읽지 못하게 해야 한다면 Gateway 봉투 암호화 대신 앱·PC 사이 E2E 암호화가 필요합니다(키 유실 대비 복구 코드 또는 비밀번호 파생 키 설계 포함).

**착수 조건** — 타인에게 운영 서비스를 제공하기로 결정할 때. 그 전엔 README 데이터 위치 절로 충분합니다.

## 4. release 재배포 시 빌드 번호 수동 증가 — 소

**배경** — `apps/mobile/app.config.js:15`·`:20`의 `buildNumber`·`versionCode`를 재배포마다 손으로 올립니다(`rules/release-build.md`). 잊으면 같은 번호로 두 빌드가 생깁니다.

**방향** — `scripts/release.sh`가 마지막 산출물 이름에서 번호를 읽어 다음 번호를 제안하고, 설정값이 그보다 작으면 멈춥니다. 자동 수정은 하지 않습니다.

**착수 조건** — 재배포를 세 번째 할 때.

## 5. 전역 ErrorBoundary — 중

**배경** — `AGENTS.md` §5는 `_layout.tsx`에 전역 오류 경계를 두라고 하지만 없습니다. DB 열기 실패는 `DatabaseProvider`의 복구 화면이, 조회·저장 실패는 `kind` 값 반환이 막습니다. 그 밖의 렌더 중 throw는 앱 전체가 흰 화면입니다.

**방향** — `ThemeProvider` 안쪽·`DatabaseProvider` 바깥에 경계를 둡니다. 화면은 재시도 하나. 원인 문구는 노출하지 않습니다(`UI_STRINGS`). dev 빌드에서는 red box를 가리지 않게 `__DEV__` 분기. 검증은 throw하는 임시 컴포넌트로 jest UI 테스트. ErrorBoundary는 비동기·이벤트 핸들러 오류를 잡지 않으므로 그 경로는 지금처럼 값으로 다룹니다.

**착수 조건** — 흰 화면이 실기기에서 한 번이라도 재현될 때, 또는 Gate C 공개 뒤.

## 6. iOS 실기기 E2E 수단 없음 — 외부 의존

**배경** — Maestro가 실기기 iOS를 지원하지 않습니다. iOS는 시뮬레이터 E2E + 실기기 수동 확인입니다.

**착수 조건** — Maestro가 지원을 추가하거나, 실기기에서만 나는 문제(백그라운드 녹음·실제 마이크)를 반복해서 놓칠 때.

## 7. 마이크 권한 «거부» 화면을 E2E로 증명 못 함 — 소

**배경** — 차단(다시 묻지 않음)은 E2E로 증명했습니다. 거부(재요청 가능)는 Android가 거부 이력 기기에서 OS 창을 건너뛰고, iOS 시뮬레이터는 `simctl privacy` 변경이 앱을 종료시켜 양쪽 다 막혔습니다(`apps/mobile/e2e/JOURNAL.md`).

**대체** — `recording-title-form.ui.test.tsx`의 denied 분기 + 수동 확인.

## 8. iOS 시뮬레이터에서 마이크 권한 꺼짐 시 녹음 시작 무반응 — 관찰만

**배경** — 시뮬레이터 한정. 실기기는 권한 없이 녹음 화면 진입이 막혀 정상입니다. 시뮬레이터 마이크 스택 차이로 보입니다.

**착수 조건** — 실기기에서 같은 증상이 재현될 때.

## 9. 전사문 KEK 회전 절차 — 소

**배경** — 전사문은 Gateway가 봉투 암호화로 잠가 저장하고 열쇠(KEK)는 `TRANSCRIPT_KEK_B64` 하나, `key_version`은 1로 고정입니다. KEK가 새면 바꿔야 하는데, 바꾸려면 옛·새 KEK를 함께 들고 각 행의 `dek_sealed`만 새 KEK로 다시 포장하고 `key_version`을 올려야 합니다. 전사문 본문은 다시 잠글 필요가 없습니다. KEK를 잃으면 서버 전사문은 복구할 수 없고 앱 SQLite 사본만 남습니다.

**현재 위치** — `services/ai-gateway/src/jobs/transcript-cipher.ts`(`KEY_VERSION`, aad에 버전 포함), migration의 `transcripts_key_version` 제약.

**방향** — 환경변수를 `TRANSCRIPT_KEK_B64`(현재)·`TRANSCRIPT_KEK_PREVIOUS_B64`(옛)로 늘리고, 읽기는 `key_version`으로 열쇠를 고르며, 1회용 스크립트가 행마다 재포장합니다. 끝나면 제약을 새 버전으로 올리고 옛 변수를 지웁니다.

**착수 조건** — KEK 노출이 의심될 때.
