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
  features/        사용자가 수행하는 행동과 유스케이스
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
- `shared`에는 EchoNote 도메인 용어와 유스케이스를 넣지 않는다.
- 재사용 가능성을 추측해 미리 slice나 공통 컴포넌트를 만들지 않는다.
- 파일이 작고 역할이 하나라면 불필요한 하위 디렉터리를 추가하지 않는다.

## 4. Slice와 Segment

도메인 slice는 kebab-case로 이름을 짓고 필요한 segment만 만든다.

```text
features/
  record-meeting/
    api/           플랫폼 녹음 서비스와 요청 코드
    model/         상태·훅·유스케이스
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
- 컴포넌트는 화면 표시와 유스케이스 조합에 집중하고 파일·네트워크 부작용은 model 또는 api segment로 이동한다.
- 상태를 무조건 전역화하지 않는다. 한 화면에서만 필요한 상태는 해당 page 또는 feature에 둔다.
- Axios는 `shared/api`의 기반 인스턴스를 통해 사용하고 UI에서 직접 호출하지 않는다.
- TanStack Query는 Gateway 서버 상태, Zustand는 검색·정렬과 화면을 넘는 일시적 UI 상태에 사용한다.
- SQLite·Supabase에 영속해야 하는 데이터를 Zustand나 Query cache만으로 보존하지 않는다.
- `useEffect`를 사용할 때는 전역 규칙의 `@when`, `@expect`, `@clear` JSDoc을 바로 위에 작성한다.

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
