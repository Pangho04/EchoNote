# EchoNote 프로젝트 규칙

이 파일은 EchoNote 저장소에서 작업하는 개발자와 코딩 에이전트가 따라야 할 프로젝트 전용 규칙이다. 사용자 명시 지시와 상위 전역 규칙이 이 파일보다 우선한다.

## 1. 프로젝트 목표와 우선순위

EchoNote는 iOS·Android·macOS에서 회의를 녹음하고, Vercel Fastify Gateway와 Supabase를 제어 계층으로 사용해 Windows GPU 추론 노드에서 전사·오전사 후보 탐지·요약을 수행하는 개인용 애플리케이션이다.

- 모바일은 Expo React Native로 구현한다.
- macOS Electron은 Expo Web 산출물을 렌더링해 모바일과 화면·라우팅을 공유한다.
- 녹음 원본과 로컬 기능은 추론 노드가 꺼져 있어도 동작해야 한다.
- 녹음 파일은 Vercel·Supabase에 저장하지 않고 Tailscale로 Windows에 직접 전송한다.
- iPhone과 Android 실기기에서 같은 코드와 앱 버전을 검증한다.
- Vercel Hobby와 Supabase Free를 포함해 카드 등록 없는 무료 도구와 무료 라이선스를 기본 전제로 한다.
- 구현 학습은 UI 컴포넌트가 아니라 도메인 수직 흐름 단위로 진행한다.

## 2. 워크스페이스 경계

```text
apps/
  mobile/          iOS·Android·Web 공통 Expo 애플리케이션
  desktop/         Electron main·preload와 macOS 플랫폼 브리지
packages/
  contracts/       클라이언트·게이트웨이 공유 Zod 계약
services/
  ai-gateway/      Vercel에 배포하는 Fastify 제어 API
  inference-worker/ Windows에서 실행할 TypeScript 추론 제어 프로세스
tools/
  stt-benchmark/   STT 품질·후보 비교 실험 도구
docs/              공개 문서
private-docs/      로컬 전용 설계·계획·개발 가이드와 샘플 자료
```

`services/inference-worker`는 해당 도메인 학습 단계에서 생성한다. FSD(Feature-Sliced Design)는 사용자 인터페이스를 구성하는 `apps/mobile/src`에 적용한다. Electron 프로세스 코드, Fastify 서비스, 계약 패키지, 벤치마크 도구에는 각 런타임에 맞는 단순한 구조를 유지한다.

`private-docs/` 전체는 `.gitignore` 대상이다. 회사 회의 자료와 로컬 설계 문서를 포함하므로 `git add -f`로 강제 추가하거나 커밋하지 않는다.

`docs/`는 공개 문서 폴더다. `.gitignore`의 허용 목록에 적힌 파일만 추적한다. 새 공개 문서는 허용 목록에 추가하고, 비공개 자료는 `docs/`에 두지 않는다.

## 3. 모바일 FSD 계층

```text
apps/mobile/src/
  app/             Expo Router 라우트·레이아웃·전역 Provider
  pages/           라우트 하나를 구성하는 전체 화면
  widgets/         여러 feature·entity를 조합한 큰 UI 블록
  features/        사용자가 수행하는 행동 단위 기능
  entities/        회의·녹음·전사·작업 등 도메인 객체
  shared/          범용 UI·유틸·설정·플랫폼 기반 코드
```

의존 방향은 위에서 아래로만 흐른다.

```text
app → pages → widgets → features → entities → shared
```

- 하위 계층은 상위 계층을 import하지 않는다.
- 같은 계층의 서로 다른 slice를 직접 import하지 않는다.
- 다른 계층은 slice의 공개 진입점인 `index.ts`를 통해 import한다. 예외로 feature의 `ui/` 컴포넌트는 `index.ts`에 내보내지 않고 `@/features/<slice>/ui/<파일>` 경로로 직접 import한다. `index.ts`가 UI를 내보내면 Node에서 도는 vitest가 React Native 소스까지 읽어 실패한다.
- `shared`에는 EchoNote 도메인 용어와 기능을 넣지 않는다. 다만 여러 slice가 함께 쓰는 route 경로(`config/routes.ts`)와 화면 문구(`config/ui-strings.ts`) 상수는 예외로 도메인별 키를 가진다. 이 파일들은 값만 두고 규칙·동작을 넣지 않는다.
- 재사용 가능성을 추측해 미리 slice나 공통 컴포넌트를 만들지 않는다.
- 파일이 작고 역할이 하나라면 불필요한 하위 디렉터리를 추가하지 않는다.

## 4. Slice와 Segment

도메인 slice는 kebab-case로 이름을 짓고 필요한 segment만 만든다.

```text
features/
  record-meeting/
    api/           플랫폼 녹음 서비스와 요청 코드
    model/         상태·함수형 ViewModel·훅·기능
    ui/            녹음 제어 UI
    index.ts       외부 공개 API

entities/
  meeting/
    api/
    model/
    ui/
    index.ts

shared/
  api/             범용 API 클라이언트 기반
  config/          환경·상수
  lib/             도메인 비종속 함수
  platform/        플랫폼 감지와 기반 브리지
  ui/              범용 RN UI 컴포넌트
```

허용 segment는 역할이 명확한 `ui`, `model`, `api`, `lib`, `config`를 우선한다. `components`, `hooks`, `utils`, `services` 같은 기술 중심 최상위 폴더를 별도로 만들지 않는다.

예상 도메인 배치는 다음을 기준으로 한다.

```text
pages/meeting-library
pages/meeting-detail
widgets/meeting-recorder
features/record-meeting
features/play-recording
features/request-transcription
features/upload-recording
features/review-transcription
features/authenticate
entities/meeting
entities/recording
entities/transcript
entities/inference-job
```

## 5. Expo Router 규칙

`apps/mobile/src/app`은 FSD의 조합 루트이면서 Expo Router의 파일 기반 라우트 디렉터리다.

- 라우트 파일에는 화면 레이아웃과 비즈니스 로직을 직접 구현하지 않는다.
- 라우트 파일은 `pages`의 공개 컴포넌트를 가져와 렌더링한다.
- `_layout.tsx`에는 Stack·Tabs·Provider·전역 오류 경계만 둔다.
- 경로 매개변수는 라우트에서 파싱한 뒤 page의 명시적 props로 전달한다.
- Expo Router를 우회하는 별도 내비게이션 시스템을 추가하지 않는다.
- 이동 경로는 `shared/config/routes.ts`의 `ROUTES`로만 만든다. `router.push`·`replace`·`Link`에 경로 문자열을 직접 조립하지 않는다.
- `ROUTES`는 `ROUTES.<도메인>.<하위 경로>` 형태로 중첩한다. 경로 생성 함수는 `as const`로 template literal 타입을 유지해 `typedRoutes`의 `Href`와 맞춘다.

```tsx
import { MeetingLibraryPage } from '@/pages/meeting-library';

export default function MeetingLibraryRoute() {
  return <MeetingLibraryPage />;
}
```

## 6. iOS·Android·Electron 공유 규칙

- 화면·라우팅·폼·상태 표현은 `apps/mobile`에서 한 번만 구현한다.
- Electron 전용 React DOM 화면을 별도로 만들지 않는다.
- 작은 표현 차이는 React Native `Platform`으로 처리한다.
- 동작 차이가 큰 기능은 같은 인터페이스의 플랫폼 파일로 분리한다.

```text
recording-service.native.ts  iOS·Android 구현
recording-service.web.ts     Electron의 Expo Web 구현
recording-service.ios.ts     iOS만 달라야 할 때
recording-service.android.ts Android만 달라야 할 때
```

- 플랫폼 조건문을 page와 widget 곳곳에 퍼뜨리지 않는다.
- Electron renderer에 Node.js API를 직접 노출하지 않는다.
- Electron 기능은 `contextIsolation`과 sandbox를 유지한 `preload`의 좁은 메서드로 제공한다.
- IPC는 채널 이름, 입력, 출력 타입을 명시하고 sender와 입력값을 검증한다.
- 모바일 백그라운드 녹음과 Electron 장시간 녹음은 각각 실기기에서 검증한다.

## 7. TypeScript와 React 규칙

- TypeScript strict 설정을 유지하고 `any`를 기본 해결책으로 사용하지 않는다.
- 외부 입력과 네트워크 경계는 Zod 계약으로 검증한다.
- React 컴포넌트는 PascalCase, 훅은 `use` 접두사, 일반 함수·변수는 camelCase를 사용한다.
- 폴더와 비컴포넌트 파일은 kebab-case를 사용한다.
- 컴포넌트는 화면 표시와 기능 조합에 집중하고 파일·네트워크 부작용은 model 또는 api segment로 이동한다.
- 상태를 무조건 전역화하지 않는다. 한 화면에서만 필요한 상태는 해당 page 또는 feature에 둔다.
- Axios는 `shared/api`의 기반 인스턴스를 통해 사용하고 UI에서 직접 호출하지 않는다.
- TanStack Query는 Gateway 서버 상태에 사용한다. 검색처럼 한 화면에서만 필요한 상태는 page-local로
  시작하고, 검색·정렬·현재 선택이 실제로 여러 화면을 넘을 때만 Zustand를 사용한다.
- SQLite·Supabase에 영속해야 하는 데이터를 Zustand나 Query cache만으로 보존하지 않는다.
- `useEffect`를 사용할 때는 전역 규칙의 `@when`, `@expect`, `@clear` JSDoc을 바로 위에 작성한다.

- 주석·중간 변수·주입 함수 이름·import 그룹·세로 여백 규칙: 코드 작성 전 반드시 읽는다 → `rules/code-style.md`
- **판별 union 분기**: `kind` 같은 판별 필드 분기는 `switch`로 전수 처리한다. 삼항과 `null`을 나열해 분기하지 않는다. 새 멤버가 생기면 반환 타입에서 누락이 드러나야 한다.
- **용어**: 「유스케이스」·「use case」 대신 「기능」을 쓴다. feature 계층이 소유하는 함수는 「기능 함수」다.
- **UI 기준**: 화면은 `private-docs/ui/echonote-ui-plan.html`의 RN 구현 Inspector 명세(`data-spec-id`별 component·tokens·rn·structure)를 따른다. 목업과 다르게 만들 부분은 설계 카드의 파일별 변경 칸에 편차로 적고 승인받는다. FSD 위치는 목업보다 현재 코드 구조가 우선한다.
- **화면 문구**: 사용자에게 보이는 문구는 `shared/config/ui-strings.ts`의 `UI_STRINGS`에 도메인별로 둔다. 버튼 라벨, 접근성 라벨, placeholder도 포함한다. `throw new Error(...)`에 쓰는 개발자용 진단 문구는 넣지 않는다.
- **팝업**: 모든 팝업은 `shared/ui/dialog`의 `useDialog`로 띄운다. 화면이 `Modal`이나 native `Alert`을 직접 쓰지 않는다. native `Alert`은 react-native-web에서 동작하지 않아 Electron에서 안내가 사라진다.
- 문구형 팝업은 `title`·`message`·`actions`로, 자체 상태가 필요한 팝업은 `content`로 컴포넌트를 넘긴다. `content`에 넘긴 JSX는 열릴 때 캡처되므로, 팝업이 열린 뒤 바뀌는 값은 바깥에서 props로 내리지 않고 그 컴포넌트가 직접 소유한다.

- 포트·계획·순수 함수는 설계서에 있다는 이유만으로 만들지 않는다. 코드에서 실제 호출되는지 확인한 뒤 구현하고, 만들었으면 반드시 부수효과 흐름에 연결해 테스트로 고정한다. 호출자가 없는 죽은 코드를 만들지 않는다.

### 7.1 ViewModel과 표현 데이터 흐름

Meeting·Recording·목록·SQLite·ViewModel 작업 전 반드시 읽는다 → `rules/mobile-domain.md`

## 8. 저장과 보안 규칙

- 녹음 원본을 추론 결과나 편집본으로 덮어쓰지 않는다.
- 회의 메타데이터와 오디오는 앱 로컬 SQLite·파일 영역을 원본으로 유지한다.
- 서버 처리 작업·전사·요약·revision은 Supabase를 원본으로 두고 앱 SQLite에 내려받는다.
- Supabase 사용자 세션은 iOS Keychain·Android Keystore·Electron `safeStorage`에 저장한다.
- 전사 본문은 Gateway가 봉투 암호화(AES-256-GCM, 행마다 DEK, DEK는 KEK로 포장)로 잠가 Supabase에 저장한다. KEK(`TRANSCRIPT_KEK_B64`)는 Gateway 실행 환경에만 두고 Supabase·저장소·Worker에 두지 않는다.
- Supabase service role key, DB URL, Windows Worker credential, 전사문 KEK를 앱 번들에 포함하지 않는다.
- Vercel Gateway의 `/v1` API는 사용자 JWT 또는 Worker credential을 검증한다.
- Windows 업로드 API는 loopback에 바인딩하고 Tailscale Serve로만 노출한다.
- 녹음 파일과 전사·요약 본문을 Vercel·Supabase 로그에 남기지 않는다.
- Electron은 임의 IPC, 원격 Node.js 실행, 무검증 외부 탐색을 허용하지 않는다.
- 사용자가 여럿이라고 전제한다. 배포 중에도 옛 Gateway가 요청을 처리할 수 있다.
- Supabase RPC 이름에는 버전 접미사를 붙이지 않는다. 호출 모양(매개변수·반환)이 깨지는 변경만 확장→축소(expand/contract) 순서를 따른다.
  1. 확장: 옛 함수를 남긴 채 새 매개변수에 default를 주거나, 불가능하면 `_v2` 같은 새 이름으로 추가한다.
  2. Gateway를 배포해 새 함수를 호출한다.
  3. 축소: 옛 Gateway가 사라진 뒤 다음 migration에서 옛 함수를 지운다. 같은 migration에서 지우지 않는다.
- 앱 SQLite migration은 배포한 적 없는 version만 합칠 수 있다. 배포한 version은 이어지는 migration으로만 바꾼다.

## 9. 개발과 검증

저장소의 Node 버전을 먼저 적용한다.

```bash
nvm use
corepack enable
pnpm install
```

일상 개발 명령은 다음을 사용한다.

```bash
pnpm dev:mobile
pnpm dev:mobile:ios
pnpm dev:mobile:aos
pnpm dev:desktop
pnpm dev:gateway
pnpm dev:worker
```

변경 완료 전 기본 검증은 다음과 같다.

```bash
pnpm verify
```

- RN 기능 단계는 iPhone·Android 실기기 모두 통과해야 완료다.
- Expo Go 결과는 백그라운드 녹음 합격 근거로 사용하지 않는다.
- 네이티브 패키지·권한·Expo 플러그인이 변경되면 양쪽 개발 앱을 다시 빌드한다.
- 플랫폼 어댑터는 공통 계약 테스트와 플랫폼별 통합 검증을 함께 둔다.
- release 빌드·재설치·서명 키 작업 전 반드시 읽는다 → `rules/release-build.md`

## 10. Git 규칙

- 커밋 메시지는 Conventional Commits 형식과 한글 설명을 사용한다.
- 예: `chore: iOS, Android 초기 세팅 스캐폴딩`
- 기능은 `feat`, 버그는 `fix`, 구조 변경은 `refactor`, 문서는 `docs`, 설정은 `chore`를 사용한다.
- 한 커밋에는 하나의 논리적 변경만 포함한다.
- 생성 파일, 비밀값, 녹음 샘플, 로컬 검증 산출물을 커밋하지 않는다.
- 커밋 메시지에 AI 생성 표기나 `Co-Authored-By`를 추가하지 않는다.

## 11. 구현 가이드 학습 방식

`private-docs/guides/echonote-job-mvp-implementation-guide.html`는 v6 「구현 선행 + 결정 기록」 방식으로 운영한다.

- 에이전트가 production·test·migration·통합·검증을 전부 구현한다.
- 사용자는 구현 전 설계 승인, 구현 뒤 결정 기록 확인, 실기기 확인을 맡는다.
- checkpoint 진행 순서는 설계안 제시 → 사용자 승인 → 구현 → 자동 검증 → 결정 기록 → 사용자 확인 → 제품 PASS다. 학습 단계가 다음 checkpoint 착수를 막지 않는다.
- 설계 승인 카드는 목적·완료 동작, 처리 흐름, 파일별 변경, 실패·제외 범위, 검증·사용자 확인 다섯 칸을 포함한다.
- 사용자에게 하는 설명·설계 카드·결정 기록에서 OS 시스템 콜·보안·DB·네트워크 용어는 첫 등장 때 쉬운 뜻을 한 줄 붙인다. 사용자는 이 분야 배경지식을 전제하지 않는다.
- 같은 글에서 전문용어·축약어는 되도록 쉬운 말로 풀어 쓴다.
  - 쉬운 말로 바꾼 전문용어는 원문을 괄호에 적는다. 예: 작업 점유권(lease)
  - 축약어는 풀어 쓴다. 자주 쓰이는 축약어라면 풀어 쓴 뒤 괄호에 축약어를 적는다. 예: 데이터베이스 구조 변경 파일(migration), 응용 프로그램 접속 주소(API)
  - 코드 식별자·명령어·파일 경로는 원문 그대로 두고, 처음 나올 때 무엇인지 한 줄 붙인다.
- 승인 범위 밖의 새 파일·공개 API·DB schema·package/config·사용자 동작이 필요하면 구현을 멈추고 수정 설계안을 다시 승인받는다.
- 이력서 정식 반영 기준점은 Gate C 공개다. Gate A·B는 내부 마일스톤이다. checkpoint는 Gate 경계에서만 멈추고 연속으로 진행한다.
- 미룬 작업은 `docs/BACKLOG.md`에 적는다. 설계 카드를 쓰기 전에 읽고, 겹치는 항목이 있으면 카드에 번호를 적는다. 끝난 항목은 지운다.

### 11.1 결정 기록과 퀴즈 범위

결정 기록 작성·갱신 전 반드시 읽는다 → `rules/decision-records.md`
