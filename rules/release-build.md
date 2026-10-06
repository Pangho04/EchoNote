# release 빌드와 재설치

Metro 없이 혼자 동작하는 release 앱을 로컬 Mac에서 빌드해 기기에 직접 설치한다. EAS와 스토어 배포는 쓰지 않는다.

## 두 앱

| 구분    | 홈 화면 이름   | ID                        | 링크 scheme    |
| ------- | -------------- | ------------------------- | -------------- |
| release | `EchoNote`     | `dev.pangho.echonote`     | `echonote`     |
| 개발    | `EchoNote:Dev` | `dev.pangho.echonote.dev` | `echonote-dev` |

- `app.config.js`가 `APP_VARIANT=release`일 때만 release 값을 쓴다. 기본은 개발 앱이다.
- ID가 달라 한 기기에 둘 다 설치된다. 데이터도 따로 가진다.
- `ios`·`android` 폴더는 평소 개발 앱 설정이다. release 스크립트가 끝나면 개발 설정으로 되돌린다.
- E2E와 테스트는 개발 앱과 iPhone 12 mini·Android에서만 한다. iPhone 16 Pro에는 release만 설치한다.

## 빌드·설치

```bash
pnpm release:mobile:aos "<adb 시리얼>"   # 생략하면 ANDROID_SERIAL 또는 연결된 기기 1대
pnpm release:mobile:ios "<기기 이름>"     # 생략하면 목록에서 고른다
```

- 빌드 전에 `apps/mobile/.env.production.local`이 있어야 한다. 없으면 스크립트가 멈춘다.
  - 운영 Supabase 값과 운영 Vercel Gateway 주소를 담는다. 사용자가 직접 관리한다.
  - 이 파일에 없는 키는 `.env.local`의 개발 값으로 채워진다. 내부 IP Gateway 주소가 들어가면 Mac 밖에서 동작하지 않는다.
  - 스크립트는 `EXPO_PUBLIC_GATEWAY_URL`이 `https://`로 시작하는지만 확인한다.
- 산출물은 `~/.echonote/builds/`에 버전·빌드 번호·날짜 이름으로 보관한다.
- 스크립트가 도중에 죽어 네이티브 폴더가 release로 남으면 `pnpm --filter @echonote/mobile native:generate:aos|ios`로 되돌린다.
- release를 다시 배포할 때 `app.config.js`의 `ios.buildNumber`·`android.versionCode`를 올린다.

## 확인 항목

빌드 뒤 다음을 확인한다. 주소는 개수만 세고 출력하지 않는다.

- 번들에 운영 Gateway 호스트 1건 이상, `192.168.`·`:4317` 0건.
- Info.plist·AndroidManifest에 `exp+echonote` 0건.
- Android APK 서명 지문이 release 키 지문과 같고 debug 키와 다름(`apksigner verify --print-certs`).

## iOS: 7일 재설치

- 무료 개인 팀 서명이라 설치 7일 뒤 앱이 실행되지 않는다.
- 만료 전에 `pnpm release:mobile:ios`로 다시 빌드해 설치한다. 같은 팀 서명이라 덮어써도 데이터가 남는다.
- 무료 팀은 기기당 활성 앱 3개까지다.

## Android 서명 키

- 키는 `~/.echonote/release.keystore`, 서명 설정은 `~/.gradle/gradle.properties`의 `ECHONOTE_RELEASE_*` 4개 항목에 있다. 둘 다 저장소 밖이다.
- `plugins/with-release-signing.js`는 생성되는 `build.gradle`에 속성 이름만 넣는다. 값이 없으면 빌드가 멈춘다.
- `ECHONOTE_RELEASE_STORE_FILE`은 절대경로로 쓴다. Gradle은 `~`를 풀지 않는다.
- 두 파일은 사용자가 저장소·Mac 밖(비밀번호 관리자, 암호화 외장 저장소)에 함께 백업한다. 비밀번호와 키 내용을 대화·로그·문서에 출력하지 않는다.
- 백업에서 되살린 뒤 `keytool -list -v`의 SHA256 지문이 설치된 APK의 `apksigner verify --print-certs` 지문과 같은지 대조한다.
- 키를 잃으면 release 앱을 업데이트할 수 없다. 앱을 지우고 새 키로 설치해야 하며 그때 로컬 데이터가 사라진다.

## Android: 서명이 다른 앱 위에 설치

- 같은 ID에 다른 키로 서명된 앱이 있으면 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`로 실패한다. 스크립트는 여기서 멈춘다.
- release APK는 debuggable이 아니라 `run-as`로 데이터를 넣을 수 없다. 데이터를 옮겨야 하면 다음 순서를 따른다.
  1. 기존 앱의 `files/SQLite`·`files/recordings`를 `run-as ... tar`로 Mac에 백업하고 해시를 대조한다.
  2. 사용자 확인 뒤 기존 앱을 지운다.
  3. 임시 debuggable APK를 빌드해 설치한다. 생성 폴더만 고치고 저장소 코드는 바꾸지 않는다.
     - `apps/mobile`에서 `APP_VARIANT=release NODE_ENV=production CI=1 pnpm exec expo prebuild --clean --platform android`
     - `android/app/build.gradle`의 `buildTypes { release {` 바로 아래에 `debuggable true` 추가
     - `cd android && APP_VARIANT=release NODE_ENV=production ./gradlew assembleRelease --no-daemon` 뒤 `adb install`
  4. 개발 앱 데이터를 `run-as`로 복사하고 해시를 대조한다.
  5. 정식 release APK를 `adb install -r`로 덮어 설치한다. 서명이 같아 데이터가 유지된다.
  6. 네이티브 폴더를 개발 설정으로 되돌리고 임시 APK를 지운다.
