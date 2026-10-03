# 트러블슈팅

개발·실기기 검증 중 부딪혀 원인을 찾은 문제와 대응을 남긴다. 앱 코드로는 고칠 수 없거나, 증상만 보고 앱 버그로 오인하기 쉬운 항목도 여기에 둔다.

## iOS dev 빌드에서 Expo 개발용 플로팅 버블(FAB)이 안 보임

**증상** — 앱을 강제 종료한 뒤 다시 실행하면 우하단 Expo 개발 메뉴 버블이 간헐적으로 나타나지 않는다. 그 자리를 눌러도 반응이 없다. 앱 자체 UI(녹음 플로팅 버튼 등)는 정상이다.

**원인** — `expo-dev-menu`의 `ios/DevMenuManager.swift` `updateFABVisibility()`는 FAB window를 만들 때 `.foregroundActive` 상태인 `UIWindowScene`을 요구한다. 콜드 스타트에서 RN 콘텐츠 등장이 scene 활성화보다 빠르면 window를 만들지 않고 종료하며, 이후 `fabWindow?.setVisible(...)`은 nil이라 무시된다. 재시도 경로가 없다 — 호출자는 `setAppContext`와 `RCTContentDidAppear` 옵저버뿐이고 후자는 1회 발화 후 스스로 제거된다.

**범위** — 라이브러리 버그이며 dev 빌드에만 존재한다. 릴리스 빌드에는 FAB 자체가 없다. expo-dev-menu 57.0.18(최신 stable)과 58.0.0 canary 모두 같은 로직이라 버전을 올려도 해결되지 않는다.

**대응** — 앱 코드에 개발용 우회를 넣지 않는다. FAB이 없으면 기기를 흔들어(shake) dev menu를 연다. 세 손가락 길게 누르기도 같은 메뉴를 연다.

## iOS 녹음 말소리가 작고 소음이 큼

**증상** — `expo-audio`(`AVAudioRecorder`) 녹음에서 1m 말소리가 약 −41 LUFS로 작고 배경 소음이 그대로 남는다.

**원인** — `AVAudioRecorder`는 음성 처리(voice processing, VP)를 켤 수 없다. VP를 켜도 음량은 약 −42 LUFS 그대로이고 소음만 줄어든다. VP는 12 kHz 이상을 자르지만 Whisper는 16 kHz로 읽어 영향이 없다.

**대응** — 로컬 Expo 모듈 `modules/voice-recorder`(`VoiceRecorderModule.swift`)가 `AVAudioEngine`의 `inputNode`에 VP를 켜고 +24 dB 증폭과 −1 dBFS limiter를 거쳐 AAC m4a로 쓴다. 목표는 −18 LUFS다. 녹음 뒤 파일을 키우는 방식은 소음도 함께 커져 쓰지 않는다. `setPrefersEchoCancelledInput`은 iOS 18.2 이상·2024년 이후 일부 iPhone만 지원하고, `AVCaptureDevice.MicrophoneMode`(voiceIsolation 등)는 사용자가 제어 센터에서 고르며 앱은 읽기만 가능해 쓰지 않는다.

## iOS AVAudioEngine 녹음에서 목소리가 떨리고 길이가 실제와 다름

**증상** — 녹음 파일에서 목소리가 떨리고, 파일 길이가 실제 녹음 시간과 다르다. 파형을 보면 70~80 ms마다 완전 무음(0) 칸이 끼어 있다.

**원인**(추정) — limiter AudioUnit → mixer → `mainMixerNode`(출력 볼륨 0)로 연결하고 mixer에 tap을 달면, engine이 출력 속도에 맞춰 입력을 당겨 입력이 모자란 순간 0을 채운다.

**대응** — 출력 그래프에 연결하지 않고 `inputNode`에 직접 tap을 단다. 증폭·limiter는 tap 콜백에서 코드로 처리한다. 입력이 48 kHz mono가 아닐 때만 `AVAudioConverter`를 쓴다. 이후 녹음에서 무음 칸이 0개다.

## Android 녹음 말소리가 작음

**증상** — `expo-audio` 녹음은 입력 소스가 `mic` −42.6, `voice_recognition` −52.6, `voice_communication` −26.9 LUFS로 목표(−18 LUFS)보다 작다.

**원인** — `expo-audio` Android는 `MediaRecorder`를 쓰며 입력을 키우는 API가 없다.

**대응** — 같은 `modules/voice-recorder`의 Android 구현(`VoiceRecorderModule.kt`)이 `AudioRecord(VOICE_COMMUNICATION)` 입력을 +11 dB 증폭하고 −1 dBFS limiter를 거쳐 `MediaCodec` AAC·`MediaMuxer`로 m4a에 쓴다. 백그라운드 녹음은 microphone 유형 foreground service(`VoiceRecordingService`)가 "녹음 중" 알림을 띄워 유지한다. 처음 +9 dB에서 −20.5 LUFS가 나와 +11 dB로 올렸다.

## Android 녹음 파일에 완전 무음 구간이 많음

**증상** — 삼성 Galaxy Z Flip5 녹음을 분석하면 10 ms 완전 무음(0) 칸이 전체의 30%를 넘는다.

**원인** — 기기의 `voice_communication` 처리가 말이 없는 구간을 0으로 만든다. 앱 버그가 아니다. 기존 `expo-audio` 녹음도 31%, VoiceRecorder 녹음은 37%로 모양이 같고, 60 ms 이하 짧은 무음은 기존 초당 0.42회, VoiceRecorder 초당 0.26회다. 일정 간격으로 반복되는 끊김(위 iOS `AVAudioEngine` 항목)과 구분된다.

**대응** — 끊김 판정은 무음 칸 개수가 아니라 기존 녹음과의 분포 비교, 그리고 짧은 무음이 규칙적으로 반복되는지로 한다.

## 로컬 Expo 모듈 Android 빌드가 `versionName is not defined`로 실패

**증상** — `expo run:android`가 `A problem occurred configuring project ':voice-recorder'. > 'android.defaultConfig.versionName' is not defined`로 실패한다.

**대응** — 모듈 `android/build.gradle`의 `android {}`에 `defaultConfig { versionCode 1; versionName "0.0.1" }`를 둔다.

## 로컬 모듈을 Android로 빌드한 뒤 `pnpm verify`의 prettier 검사가 실패

**증상** — 로컬 Expo 모듈을 Android로 빌드한 뒤 `pnpm verify`의 prettier 검사가 실패한다.

**원인** — Gradle이 `modules/<모듈>/android/build/`에 산출물 JSON을 만든다.

**대응** — `.gitignore`와 `.prettierignore`에 `apps/mobile/modules/*/android/build/`를 둔다.

## `npx expo run:ios`가 `Cannot determine the project's Expo SDK version`으로 실패

**증상** — `apps/mobile`에서 `npx expo run:ios`를 실행하면 `Cannot determine the project's Expo SDK version`으로 실패한다.

**대응** — `apps/mobile`에서 `pnpm exec expo run:ios --device <기기> --no-bundler`로 실행한다.

## `adb`가 `more than one device/emulator`로 실패

**증상** — `adb` 명령이 `more than one device/emulator`로 실패한다.

**원인** — 무선 디버깅 기기 하나가 mDNS 이름과 `IP:포트` 두 항목으로 동시에 잡힌다.

**대응** — `adb devices`에서 `IP:포트` 항목을 골라 `adb -s <IP:포트>`로 지정한다.

## Windows Worker 업로드 PUT이 502 `upload_completion_failed`, 로그 `reason: network`

**증상** — 녹음 PUT은 Worker까지 도달하지만 502 `upload_completion_failed`를 받는다. Worker 로그는 `upload completion failed`, `reason: network`이고 job은 `created`에 머문다. final 파일은 남는다.

**원인** — Worker가 `GATEWAY_BASE_URL`로 Gateway에 연결하지 못한다. 시작 검증은 URL 형식만 보므로 아래 값도 통과한다.

- `http://127.0.0.1:4317`처럼 loopback을 넣으면 Windows 자기 자신을 가리켜 연결이 거부된다. loopback http는 Gateway와 Worker를 한 기기에서 띄울 때만 쓴다.
- 호스트명 끝에 글자가 붙은 오타(`.ts.netw`)는 형식상 유효한 origin이라 이름 해석에서 `ENOTFOUND`로 실패한다.

**대응** — Windows 저장소 루트에서 URL·token을 출력하지 않고 연결만 확인한다.

```powershell
node --env-file=services/inference-worker/.env.local -e "fetch(new URL('/v1/worker/upload-completions', process.env.GATEWAY_BASE_URL), {method: 'POST'}).then((r) => console.log('status', r.status)).catch((e) => console.log('code', e.cause?.code ?? e.name))"
```

| 출력                | 판정                                          |
| ------------------- | --------------------------------------------- |
| `status 401`        | 경로 정상. Worker가 옛 env로 떠 있으면 재시작 |
| `code ECONNREFUSED` | 주소가 Gateway가 아님(loopback 등)            |
| `code ENOTFOUND`    | 호스트명 오타 또는 MagicDNS 해석 실패         |

`GATEWAY_BASE_URL`은 Gateway 기기에서 `tailscale serve status`로 확인한 https origin을 path 없이 넣는다. `.env.local`을 고친 뒤에는 Worker를 재시작한다. 실패한 job은 새 grant로 다시 PUT하면 같은 완료 통지를 재전송한다.

## Vercel 빌드가 `Response`에 TS2339로 실패

**증상** — Gateway를 Vercel에 배포하면 빌드가 `services/ai-gateway/src/*.ts`의 `Response`에 `Property ... does not exist` 같은 TS2339로 실패한다.

**원인** — Vercel zero-config Fastify 빌드는 `@vercel/fastify` 빌더(내부적으로 `@vercel/node`)가 타입 오류를 빌드 실패로 처리한다. 이 빌더의 타입 검사 호스트는 symlink 실경로를 따라가지 않는다. pnpm 격리(`isolated`) 배치에서 `@types/node` 옆에 있어야 할 `undici-types`를 못 찾아 전역 `Response` 타입이 빈 interface가 된다.

**대응** — `undici-types`를 `pnpm-workspace.yaml`의 `catalog`(`~7.18.0`, `@types/node`가 요구하는 범위와 맞춤)로 두고 `services/ai-gateway/package.json`에 직접 devDependency로 추가한다.

## Vercel 함수가 500 `Invalid export found in module src/server.js`

**증상** — 빌드는 성공하지만 배포된 함수를 호출하면 500과 `Invalid export found in module src/server.js`를 받는다.

**원인** — Vercel Fastify 빌더는 `app, index, server, src/app, src/index, src/server` 후보 파일 중 fastify를 import하는 내용을 가진 파일만 진입점으로 고른다. 이 선택 방식은 설정으로 바꿀 수 없다. `src/index.ts`가 fastify를 직접 import하지 않아 서버를 만들기만 하는 `src/server.ts`가 대신 선택된다.

**대응** — `src/index.ts` 맨 위에 `import 'fastify';`를 추가해 빌더가 `index.ts`를 진입점으로 고르게 한다.

## Vercel 배포 뒤 요청이 멈추고 500

**증상** — 진입 파일 문제를 고친 뒤에도 배포된 함수에 요청을 보내면 응답 없이 멈추다가 결국 500이 난다.

**원인** — Vercel은 `http.Server.prototype.listen`을 가로채 서버 설정만 잡고 완료 콜백을 부르지 않는다. `await server.listen(...)`으로 작성하면 이 await가 끝나지 않아 모듈 로드 자체가 끝나지 않고, Vercel이 요청을 그 함수로 넘기지 못한다.

**대응** — `server.listen(...).catch((error) => { ... })`로 await하지 않고 실패만 처리한다.

**참고** — 진단용 명령을 Vercel 프로젝트 `buildCommand`에 넣을 때 256자를 넘으면 `Error: If defined, the Build Command must have a maximum length of 256 characters. (400)`로 거부된다. 진단이 끝나면 `buildCommand`를 원래 값으로 되돌린다.

## 모바일의 Gateway 요청이 전부 401

**증상** — 모바일 로그인은 되지만 `/v1` 요청이 모두 401이다.

**원인** — 모바일은 원격 Supabase로 로그인하는데 Gateway가 로컬 Supabase 기준으로 JWT를 검증한다. `pnpm dev:gateway:test`로 띄우면 `.env.test.local`의 로컬 `SUPABASE_URL`이 `.env.local` 값을 덮는다.

**대응** — 모바일과 연동할 때는 `pnpm dev:gateway`로 띄운다. `.env.local`의 `SUPABASE_URL`이 모바일 `EXPO_PUBLIC_SUPABASE_URL`과 같은 프로젝트인지 확인한다.

## Android 개발 빌드가 `Can't find ViewManager 'ViewManagerAdapter_ExpoUI_HStackView'`로 열리지 않음

**증상** — `dropdown-menu.android.tsx` 같은 플랫폼 파일을 Metro(번들 서버)가 켜진 상태에서 새로 만든 뒤 앱이 이 오류로 멈춘다. `HStackView`는 iOS SwiftUI 부품이라, Android가 iOS용 `dropdown-menu.tsx`를 받고 있었다는 뜻이다.

**원인(추정)** — Metro가 새 플랫폼 파일 생성 전에 결정한 모듈 경로를 그대로 유지한다. `--clear`로 다시 띄우면 해소된다.

**대응** — `pnpm -F mobile start --clear`. 플랫폼 파일(`.android`·`.ios`·`.native`·`.web`)을 새로 추가하면 Metro 캐시를 비우고 다시 띄운다.

## iPhone 실기기 maestro-runner가 `Failed to create session ... connection reset by peer`

**증상** — 로그에 WDA(WebDriverAgent) started successfully 직후 곧바로 연결이 끊기고, `DVTSecureSocketProxy ... Have you mounted the Developer Image?`가 같이 찍힌다.

**대응** — iPhone 잠금을 풀고 다시 실행하면 통과한다. 실행 중에는 잠금 해제 상태를 유지한다.

## `expo run:ios`가 `Connecting to <기기>`에서 멈춤

**증상** — iPhone 실기기 빌드는 끝났는데 설치 단계 `Connecting to <기기>`에서 몇 분째 진행되지 않는다.

**대응** — 프로세스를 끝내고 빌드 산출물을 `devicectl`로 직접 설치·실행한다.

```bash
xcrun devicectl device install app --device <udid> <DerivedData>/Build/Products/Debug-iphoneos/EchoNote.app
xcrun devicectl device process launch --terminate-existing --device <udid> \
  --payload-url "exp+echonote://expo-development-client/?url=http%3A%2F%2F<MAC_IP>%3A8081" dev.pangho.echonote
```

## iPhone 실기기 maestro-runner가 `failed to start port forwarding: device <udid> not found`

**증상** — WDA 빌드·실행까지 진행한 뒤 포트 포워딩 단계에서 기기를 찾지 못한다. `devicectl`로는 기기가 `connected`(Transport Type `localNetwork`)라 앱 설치·실행은 된다.

**원인** — maestro-runner는 usbmuxd로 포트를 연다. 무선 기기가 usbmuxd 목록에서 빠지면 `devicectl` 연결과 무관하게 실패한다.

**확인** — usbmuxd `ListDevices` 결과가 0대인지 본다. libimobiledevice(`idevice_id`)가 없으면 Python으로 `/var/run/usbmuxd`에 `ListDevices` plist를 보내 확인한다.

**대응** — iPhone 잠금을 풀고 화면을 켠 뒤 목록에 다시 잡히는지 본다. 그래도 0대면 USB로 연결하거나 `sudo launchctl kickstart -k system/com.apple.usbmuxd`로 usbmuxd를 다시 시작한다.
