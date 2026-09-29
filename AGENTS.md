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
docs/              로컬 전용 설계·계획·개발 가이드와 샘플 자료
```

`services/inference-worker`는 해당 도메인 학습 단계에서 생성한다. FSD(Feature-Sliced Design)는 사용자 인터페이스를 구성하는 `apps/mobile/src`에 적용한다. Electron 프로세스 코드, Fastify 서비스, 계약 패키지, 벤치마크 도구에는 각 런타임에 맞는 단순한 구조를 유지한다.

`docs/` 전체는 `.gitignore` 대상이다. 회사 회의 자료와 로컬 설계 문서를 포함하므로 `git add -f`로 강제 추가하거나 커밋하지 않는다.

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
- 다른 계층은 slice의 공개 진입점인 `index.ts`를 통해 import한다.
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

- **주석 위치**: 주석은 설명 대상 바로 위에 둔다. 여러 줄을 설명하는 주석을 함수 상단에 모아 두지 않는다.
- **주석 용어**: 실제 동작보다 큰 낱말을 쓰지 않는다. 타입만 확인하는 코드를 `parse`나 `정규화`로 부르지 않는다.
- **중간 변수**: 한 줄에 들어가고 한 번만 쓰이는 식은 변수로 빼지 않고 사용처에 인라인한다.
- **주입 함수 이름**: 인자로 받는 함수는 무엇을 하는지까지 이름에 담는다. `load`가 아니라 `loadMeetingDetail`을 쓴다.
- **판별 union 분기**: `kind` 같은 판별 필드 분기는 `switch`로 전수 처리한다. 삼항과 `null`을 나열해 분기하지 않는다. 새 멤버가 생기면 반환 타입에서 누락이 드러나야 한다.
- **용어**: 「유스케이스」·「use case」 대신 「기능」을 쓴다. feature 계층이 소유하는 함수는 「기능 함수」다.
- **UI 기준**: 화면은 `docs/ui/echonote-ui-plan.html`의 RN 구현 Inspector 명세(`data-spec-id`별 component·tokens·rn·structure)를 따른다. 목업과 다르게 만들 부분은 설계 카드의 파일별 변경 칸에 편차로 적고 승인받는다. FSD 위치는 목업보다 현재 코드 구조가 우선한다.
- **화면 문구**: 사용자에게 보이는 문구는 `shared/config/ui-strings.ts`의 `UI_STRINGS`에 도메인별로 둔다. 버튼 라벨, 접근성 라벨, placeholder도 포함한다. `throw new Error(...)`에 쓰는 개발자용 진단 문구는 넣지 않는다.
- **팝업**: 모든 팝업은 `shared/ui/dialog`의 `useDialog`로 띄운다. 화면이 `Modal`이나 native `Alert`을 직접 쓰지 않는다. native `Alert`은 react-native-web에서 동작하지 않아 Electron에서 안내가 사라진다.
- 문구형 팝업은 `title`·`message`·`actions`로, 자체 상태가 필요한 팝업은 `content`로 컴포넌트를 넘긴다. `content`에 넘긴 JSX는 열릴 때 캡처되므로, 팝업이 열린 뒤 바뀌는 값은 바깥에서 props로 내리지 않고 그 컴포넌트가 직접 소유한다.

- **import 그룹화**: `외부 패키지 → @/ 별칭 → 상대 경로` 순서로 그룹화하고 **그룹 사이에만 빈 줄**을 둔다. 같은 그룹 내부는 빈 줄 없이 연속. `simple-import-sort` 자동수정 기준.

- **세로 여백(카테고리 전환 시 빈 줄)** — **모든 선언·문장 레벨**에 적용:
  - **카테고리 정의**: `선언(const/let/interface/type/enum)` · `조건(if/else/switch)` · `반복(for/while)` · `예외(try/catch)` · `호출·표현식(함수 호출/할당 없는 await)` · `반환·중단(return/throw/break/continue)`
  - **규칙**: 연속된 두 문장의 **카테고리가 다르면 반드시 빈 줄 1줄**을 둔다.
    - 예: `const` 묶음 → `if` 분기, `try` 블록 → `const` 선언, `if` 종료 → `return` 등
  - **예외**: 한 줄 조기 반환(`if (cond) return x;`), `for` 헤더 직후 단일 본문 등 관례적 초소형 블록은 생략 가능.

- **클래스/인터페이스/타입 멤버** 사이는 동일 카테고리(빈 줄 없음). **타입·함수·클래스 등 최상위 선언끼리**는 위 규칙 적용.

- **도구 우선순위**: Prettier/ESLint와 충돌 시 본 규칙(§2.1·§2.3)을 우선한다. 편집·리뷰 시 기존 파일과 어긋나면 본 규칙 우선 적용.
- 포트·계획·순수 함수는 설계서에 있다는 이유만으로 만들지 않는다. 코드에서 실제 호출되는지 확인한 뒤 구현하고, 만들었으면 반드시 부수효과 흐름에 연결해 테스트로 고정한다. 호출자가 없는 죽은 코드를 만들지 않는다.

### 7.1 ViewModel과 표현 데이터 흐름

- 외부 데이터는 `네트워크 DTO 또는 영속 row → adapter mapper → Domain → 함수형 ViewModel → View` 순서로 변환한다. View가 DTO나 row를 직접 받지 않는다.
- 네트워크 DTO와 Domain mapper는 관련 entity·feature의 `api` segment adapter가, 영속 row와 Domain mapper는 repository adapter가 소유한다. `model`과 `ui` segment가 DTO나 row 타입에 의존하지 않는다.
- 함수형 ViewModel을 기본으로 사용한다. 관련 slice의 `model` segment에 화면 표시 타입과 `to...ViewModel` 순수 mapper를 두며 React 상태, repository 호출, 파일·네트워크 부작용을 넣지 않는다.
- page composition 또는 page의 ViewModel hook은 받은 Domain을 함수형 ViewModel로 변환해 widget·entity UI에 props로 전달한다. `MeetingList` 같은 UI 컴포넌트가 repository, API, Domain sample을 직접 import해 데이터 원본을 소유하지 않는다.
- 로딩·오류·선택·생성 중 상태나 화면 명령 조율이 필요할 때만 `use...ViewModel` hook을 해당 page·widget·feature의 `model` segment에 둔다.
- ViewModel hook은 View가 소비할 상태와 callback을 제공하고 feature의 공개 기능 함수에 위임한다. 비즈니스 규칙, SQL·HTTP, 파일 처리, 녹음기·플레이어 수명주기를 직접 구현하지 않는다.
- Feature는 사용자 행동과 그 처리 규칙을, entity Domain은 앱의 불변식과 의미를, adapter와 플랫폼 서비스는 저장·네트워크·기기 세부사항을 소유한다.
- `MeetingStatus`는 `entities/meeting/model/meeting.ts`의 string `enum` 하나로 정의한다. Domain·ViewModel은 enum member를 사용하고, SQLite Row와 서버 DTO의 raw string은 adapter 경계에서 검증해 enum으로 변환한다.
- `MeetingStatus.LocalOnly`는 모바일이 소유한다. 그 외 처리 상태는 Gateway 작업 상태를 반영하며 모바일이 임의로 전이시키지 않는다.
- SQLite outbox의 전송 상태는 `MeetingStatus`와 별도 타입으로 관리한다. `pending`, `sending`, `failed` 같은 outbox 상태를 회의 처리 상태에 추가하지 않는다.
- `Meeting 1 : 1 Recording`을 영구 원칙으로 한다. `Recording`은 별도 녹음 ID나 녹음 세션 식별자를 만들지 않고 `meetingId`를 유일한 identity로 재사용한다. SQLite `recordings.meeting_id`는 `PRIMARY KEY`이자 `meetings(id)`를 참조하는 FK다. 이 shared PK/FK만으로 parent의 필수 child 존재까지 보장되지는 않으므로 Meeting·Recording을 같은 transaction에서 생성·삭제하고 orphan 검증을 둔다. `jobId`, command ID, upload attempt ID는 같은 Recording을 여러 번 처리할 수 있게 구분하는 처리 시도 식별자이며 Recording 식별자로 합치지 않는다. `Meeting` Domain은 화면 조합을 단순하게 하기 위해 nullable `durationMs`를 가질 수 있지만, SQLite에서는 saved RecordingRow가 원본이며 `meetings` row에 복제하지 않는다.
- 학습 단계에서는 실제 경계를 도입할 때 타입을 만든다. SQLite Row는 schema 단계, ResponseDTO는 서버 API 단계에서 정의하며 사용되지 않는 경계 타입을 미리 만들지 않는다.
- SQLite `meetings` row는 `id`, 정규화한 `title`, `created_at_ms`, `updated_at_ms`만 소유한다. status는 InferenceJobRow 부재 시 `LocalOnly`, 존재 시 검증한 서버 status로 만든다.
- SQLite timestamp는 UTC epoch millisecond `INTEGER`, Domain timestamp는 ISO 8601 string을 사용한다. Row mapper만 둘을 변환한다.
- `createdAt`은 Meeting이 EchoNote에 등록된 시각이며 생성 뒤 바꾸지 않는다. 회의 목록 날짜·정렬·연도 조회·cursor·기본 제목 기준은 `createdAt`이다. `updatedAt`은 마지막 수정 시각이므로 목록 정렬이나 duration 계산에 사용하지 않는다.
- 외부에서 과거 녹음을 가져와도 가져와 등록한 시각을 Meeting의 `createdAt`으로 사용한다. 실제 녹음 시각은 MVP Meeting 관리 기준이 아니며 요구가 생기기 전 `Recording.recordedAt` 같은 미래 필드를 추가하지 않는다.
- 빈 Meeting 제목은 생성 당시 기기 IANA time zone의 `createdAt`을 `yyyy-MM-dd 오전/오후 hh:mm:ss_녹음` 형식으로 한 번 만들며, 이후 time zone 변경으로 자동 수정하지 않는다.
- 목록 기능은 선택 연도와 기기 현재 IANA time zone을 `[연도 시작, 다음 연도 시작)` UTC epoch millisecond 범위로 바꿔 `ListMeetingsQuery`로 repository에 전달한다. repository는 year나 time zone을 해석하지 않고 SQLite에서 `createdAt DESC, id DESC`로 조회하며, 전체 Row를 읽은 뒤 ViewModel에서 연도를 거르지 않는다.
- 목록 query의 `cursor`는 그 cursor가 가리키는 Meeting부터 결과에 포함한다. repository는 `limit + 1`건을 읽고, 반환하지 않은 lookahead Meeting이 있으면 그 Meeting을 `nextCursor`로 제공하며 없으면 `null`을 제공한다.
- 1B 검색은 이미 불러온 page를 ViewModel에서 거르지 않는다. 기존 SQLite 목록 query에 정규화한 title filter를 추가하고 `연도·filter → inclusive cursor → createdAt DESC, id DESC → limit + 1` 순서로 조회한다. `%`, `_`, escape 문자는 literal로 처리하며 검색어 변경 시 items·cursor를 초기화한다.
- 생성·제목 변경·삭제는 SQLite commit 성공 뒤 현재 목록 조건으로 실제 DB를 재조회한다. 화면에만 optimistic 성공 행을 확정하지 않는다.
- Stage 1의 `meetings` 단독 schema는 목록·SQLite를 배우기 위한 임시 scaffold일 뿐 제품 영속 계약이 아니다. Stage 2부터 Meeting·Recording을 `meetingId` 하나로 같은 transaction에서 생성·삭제하고, `recordings.meeting_id PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE`와 orphan 0건 검증을 적용한다. 검증용 recording table이나 fake repository를 만들지 않는다.
- 목록 날짜 label과 연도 조회는 같은 기기 현재 time zone을 사용한다. time zone이나 선택 연도가 바뀌면 기존 items와 cursor를 버리고 첫 page부터 다시 조회한다.
- `MeetingListItemVM`은 월·일과 표시 label만 가지며 `yearLabel`을 두지 않는다. 선택 연도와 연도 변경 command는 page-level ViewModel hook이 소유하고 목록 상단 control이 한 번 표시한다.
- 목록 `metaLabel`은 duration과 상세 상태 설명을 조합한다. chip은 `MeetingStatus`만 복사하지 않고 `pendingReviewCount`와 최신 outbox command를 함께 사용하며, local-only 항목처럼 chip이 필요 없으면 disclosure accessory를 사용한다. outbox 표시는 UI 우선순위일 뿐 `MeetingStatus` 전이가 아니다.
- ViewModel 필드 추가만으로 UI 변경이 승인된 것은 아니다. 새 표시 요소는 위치·타이포그래피·간격·접근성 사양이 목업에 추가된 뒤 View에서 렌더링한다.

## 8. 저장과 보안 규칙

- 녹음 원본을 추론 결과나 편집본으로 덮어쓰지 않는다.
- 회의 메타데이터와 오디오는 앱 로컬 SQLite·파일 영역을 원본으로 유지한다.
- 서버 처리 작업·전사·요약·revision은 Supabase를 원본으로 두고 앱 SQLite에 내려받는다.
- Supabase 사용자 세션은 iOS Keychain·Android Keystore·Electron `safeStorage`에 저장한다.
- Supabase service role key, DB URL, Windows Worker credential을 앱 번들에 포함하지 않는다.
- Vercel Gateway의 `/v1` API는 사용자 JWT 또는 Worker credential을 검증한다.
- Windows 업로드 API는 loopback에 바인딩하고 Tailscale Serve로만 노출한다.
- 녹음 파일과 전사·요약 본문을 Vercel·Supabase 로그에 남기지 않는다.
- Electron은 임의 IPC, 원격 Node.js 실행, 무검증 외부 탐색을 허용하지 않는다.

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

## 10. Git 규칙

- 커밋 메시지는 Conventional Commits 형식과 한글 설명을 사용한다.
- 예: `chore: iOS, Android 초기 세팅 스캐폴딩`
- 기능은 `feat`, 버그는 `fix`, 구조 변경은 `refactor`, 문서는 `docs`, 설정은 `chore`를 사용한다.
- 한 커밋에는 하나의 논리적 변경만 포함한다.
- 생성 파일, 비밀값, 녹음 샘플, 로컬 검증 산출물을 커밋하지 않는다.
- 커밋 메시지에 AI 생성 표기나 `Co-Authored-By`를 추가하지 않는다.

## 11. 구현 가이드 학습 방식

`docs/guides/echonote-job-mvp-implementation-guide.html`는 v6 「구현 선행 + 결정 기록」 방식으로 운영한다.

- 에이전트가 production·test·migration·통합·검증을 전부 구현한다.
- 사용자는 구현 전 설계 승인, 구현 뒤 결정 기록 확인, 실기기 확인을 맡는다.
- checkpoint 진행 순서는 설계안 제시 → 사용자 승인 → 구현 → 자동 검증 → 결정 기록 → 사용자 확인 → 제품 PASS다. 학습 단계가 다음 checkpoint 착수를 막지 않는다.
- 설계 승인 카드는 목적·완료 동작, 처리 흐름, 파일별 변경, 실패·제외 범위, 검증·사용자 확인 다섯 칸을 포함한다.
- 승인 범위 밖의 새 파일·공개 API·DB schema·package/config·사용자 동작이 필요하면 구현을 멈추고 수정 설계안을 다시 승인받는다.
- 이력서 정식 반영 기준점은 Gate C 공개다. Gate A·B는 내부 마일스톤이다. checkpoint는 Gate 경계에서만 멈추고 연속으로 진행한다.

가이드 checkpoint 본문에 남아 있는 「사용자가 해 줄 것」 제출물 표, 0~4점 채점, takeover 문구는 폐기된 레거시다. 그 분담을 따르지 않고 기술 내용만 사용한다.

### 11.1 결정 기록과 퀴즈 범위

결정 기록은 checkpoint마다 하나씩 `docs/learning/<checkpoint>-결정기록.md`에 둔다.

- 항목은 그 checkpoint에서 새로 내린 설계 선택만 담는다. 개수는 제한하지 않는다. 같은 선택에서 파생된 세부 결정은 별도 항목으로 쪼개지 않고 한 항목에 묶는다.
- 항목 형식은 결정 / 흐름(호출 사슬) / 핵심 코드 발췌 / 입력별 추적 / 왜·버린 대안·트레이드오프다.
- 주제가 바뀌면 소제목으로 끊는다. 흐름·구조는 다이어그램, 비교·추적·분기는 표로 쓴다.
- 문체는 caveman 단문이다. 접속어·수식어·반복 설명을 빼고 화살표(→)와 가운뎃점(·)으로 잇는다.
- 한 줄에 한 사실만 쓴다. 설명은 산문 문단 대신 bullet로 쓰고, bullet 하나에 문장은 하나만 둔다. 하위 사실은 들여쓴 bullet으로 내린다.
- 분량을 절제한다. 머리말 bullet은 5줄, 흐름 다이어그램은 10줄 이내로 쓴다. 코드 블록은 항목당 2개, 블록당 15줄 이내로 쓰고 생략은 `...`로 표시한다. 왜·대안 bullet은 항목당 5개 이내다.
- 항목마다 범주 하나를 붙인다. **아키텍처**(FSD 계층·의존 방향·경계·합성 루트), **RN·Expo 고유**(expo-router, expo-sqlite, expo-audio, expo-file-system, 플랫폼 파일 분리, native 어댑터), **DB**(schema·migration·PRAGMA·transaction·Row 매핑·조회 조건).
- 퀴즈는 Gate C 구현을 마친 뒤, 프로젝트 공개 전에 전체 결정 기록 범위로 한 번 출제한다. 배점은 아키텍처 40, RN·Expo 30, DB 30이다. 문법·스타일 문항은 출제하지 않는다.
- 주제별 통합 학습 문서(아키텍처 → DB → RN·Expo 순)는 퀴즈 전에 같은 범위로 만든다.
- Gate 경계마다 결정 기록의 코드 발췌를 현재 코드와 대조해 갱신하고, 바뀐 자리에 원인 결정 링크를 남긴다.
- 결정 기록에 넣지 않는 것: TypeScript 문법(union·제네릭·`as const`), React 훅 기본 사용법(`useMemo`와 `useCallback` 차이, deps 규칙), 스타일 수치, 네이밍·주석 규약. 이 규칙들은 §7이 소유한다.
- 코드 참조는 심볼 이름(함수·타입·상수)으로 쓴다. 줄 번호를 적지 않는다. 코드가 바뀔 때 문서가 함께 깨지기 때문이다.
- G1-1~G1-6의 기존 학습플랜 문서는 그대로 두고, 더 갱신하지 않는다.
