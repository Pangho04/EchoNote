#!/usr/bin/env bash
# Metro 없이 혼자 실행되는 release 앱을 빌드해 기기에 설치한다.
# usage: release.sh <android|ios> [device]
#   android: device는 adb 시리얼. 생략하면 ANDROID_SERIAL 또는 연결된 기기 1대를 쓴다.
#   ios: device는 기기 이름. 생략하면 expo가 목록을 보여 준다.
# 끝나면 성공·실패와 관계없이 ios·android 폴더를 개발 앱 설정으로 되돌린다.
set -euo pipefail

PLATFORM=${1:?usage: release.sh <android|ios> [device]}
DEVICE=${2:-}
case "$PLATFORM" in android | ios) ;; *) echo "usage: release.sh <android|ios> [device]" >&2; exit 1 ;; esac

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT_DIR="$HOME/.echonote/builds"

# 이 파일이 없으면 .env.local의 개발 서버 주소가 release 번들에 들어간다. 내용은 읽지 않는다.
[ -f .env.production.local ] || { echo ".env.production.local이 없습니다." >&2; exit 1; }

pnpm --filter @echonote/contracts build

restore_dev_native() {
  cd "$ROOT"
  env -u APP_VARIANT -u NODE_ENV CI=1 EXPO_NO_GIT_STATUS=1 pnpm exec expo prebuild --clean --platform "$PLATFORM" ||
    echo "개발 앱 네이티브 폴더 복원 실패: pnpm --filter @echonote/mobile native:generate:${PLATFORM/android/aos} 실행 필요" >&2
}
trap restore_dev_native EXIT

export APP_VARIANT=release NODE_ENV=production CI=1 EXPO_NO_GIT_STATUS=1
pnpm exec expo prebuild --clean --platform "$PLATFORM"

STAMP="$(node -p "const c=require('./app.config.js').expo; c.version+'-'+(process.argv[1]==='ios'?c.ios.buildNumber:c.android.versionCode)" "$PLATFORM")-$(date +%Y%m%d-%H%M)"
mkdir -p "$OUT_DIR"

if [ "$PLATFORM" = android ]; then
  # 데몬은 이전 빌드의 환경변수를 들고 있을 수 있어 APP_VARIANT가 번들·앱 설정에 확실히 닿도록 끈다.
  (cd android && ./gradlew assembleRelease --no-daemon)
  APK="$OUT_DIR/echonote-$STAMP.apk"
  cp android/app/build/outputs/apk/release/app-release.apk "$APK"
  echo "보관: $APK"

  ADB=(adb)
  [ -n "$DEVICE" ] && ADB=(adb -s "$DEVICE")
  if ! result=$("${ADB[@]}" install -r "$APK" 2>&1); then
    echo "$result" >&2
    if [[ "$result" == *INSTALL_FAILED_UPDATE_INCOMPATIBLE* ]]; then
      echo "같은 ID의 앱이 다른 키로 서명돼 있습니다. 데이터를 옮긴 뒤 기존 앱을 지우고 다시 설치하세요." >&2
    fi
    exit 1
  fi
  echo "$result"
else
  DEVICE_ARGS=(--device)
  [ -n "$DEVICE" ] && DEVICE_ARGS=(--device "$DEVICE")
  pnpm exec expo run:ios --configuration Release "${DEVICE_ARGS[@]}" --no-bundler --output "$OUT_DIR/ios-$STAMP"
fi
