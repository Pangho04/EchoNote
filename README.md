# EchoNote

iOS·Android React Native 앱과 macOS Electron 앱에서 회의를 녹음하고, Vercel Fastify Gateway와 Supabase를 제어 계층으로 사용해 Tailscale로 연결된 Windows GPU 노드에서 전사와 요약을 처리하는 개인용 프로젝트다.

## 요구 환경

- Node.js `24.18.0` 최신 LTS
- pnpm `11.20.0`
- iOS 개발: 최신 안정 Xcode, CocoaPods, Apple Personal Team, iPhone 실기기
- Android 개발: 최신 안정 Android Studio와 SDK, USB 디버깅을 활성화한 Android 실기기
- 추론: Windows 11, Docker Desktop, NVIDIA GPU, Tailscale
- 배포: 카드가 등록되지 않은 Vercel Hobby, 기존 계정의 EchoNote 전용 Supabase Free 프로젝트

```bash
nvm install
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install
pnpm verify
```

## 시작 명령

```bash
# iPhone에 개발 빌드 설치
pnpm dev:mobile:ios

# Android에 개발 빌드 설치
pnpm dev:mobile:android

# 양쪽에 개발 빌드를 설치한 뒤 Metro 실행
pnpm dev:mobile

# 네이티브 프로젝트 설정만 다시 생성
pnpm --filter @echonote/mobile native:generate:ios
pnpm --filter @echonote/mobile native:generate:android

# Expo Go 화면 확인 전용. 백그라운드 녹음 합격 판정에는 사용하지 않는다.
pnpm dev:mobile:go

# Electron
pnpm dev:desktop

# 로컬 Fastify Gateway 상태 확인 골격. 제품 배포 대상은 Vercel Hobby다.
pnpm dev:gateway
```

`pnpm dev:mobile`의 QR 코드는 Expo Go용이 아니라 설치된 EchoNote 개발 빌드용이다. iPhone은 카메라로 QR을 열고, Android는 EchoNote 개발 빌드의 스캐너로 연다. 개발 빌드가 없으면 위의 플랫폼별 설치 명령을 먼저 실행한다.

RN 단계는 시뮬레이터·에뮬레이터만으로 완료 처리하지 않는다. 동일 코드와 앱 버전으로 iPhone과 Android 실기기를 모두 통과해야 한다. Android 로컬 개발 설치에는 유료 개발자 계정이나 7일 재서명 제한이 없다.

제품 기능은 UI 컴포넌트 단위가 아니라 도메인 수직 흐름으로 구현한다. 상세 설계와 단계별 학습 자료는 Git에서 제외된 로컬 `docs/`에서 관리한다.

## 버전 갱신

```bash
pnpm outdated --recursive
pnpm update --interactive --latest
pnpm --filter @echonote/mobile exec expo install --check
pnpm verify
```

Expo가 고정한 React·React Native 버전과 도구의 peer dependency를 우선한다. 호환되지 않는 최신 메이저를 강제로 설치하지 않는다.
