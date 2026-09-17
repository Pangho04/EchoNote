#!/usr/bin/env bash
# E2E 시나리오가 필요로 하는 기기 상태를 만든다.
# maestro flow는 권한이나 DB 파일을 건드릴 수 없어 바깥에서 준비한다.
set -euo pipefail

APP_ID=dev.pangho.echonote
DB_DIR_ANDROID=files/SQLite
DB_NAME=echonote.db
TMP_DB=/tmp/echonote-e2e.db

usage() {
  echo "usage: $0 <android|ios> <action> [device]"
  echo "  action: permission-grant | permission-deny | permission-block"
  echo "          table-drop | table-restore"
  exit 1
}

PLATFORM=${1:-}
ACTION=${2:-}
DEVICE=${3:-}
[ -z "$PLATFORM" ] || [ -z "$ACTION" ] && usage

android_db() {
  adb ${DEVICE:+-s "$DEVICE"} shell "run-as $APP_ID $1"
}

ios_container() {
  xcrun simctl get_app_container "${DEVICE:-booted}" "$APP_ID" data
}

case "$PLATFORM:$ACTION" in
  android:permission-grant)
    adb ${DEVICE:+-s "$DEVICE"} shell pm grant "$APP_ID" android.permission.RECORD_AUDIO ;;
  android:permission-deny)
    # 다시 물어볼 수 있는 단순 거부 상태. 앱이 요청하면 OS 창이 뜬다.
    adb ${DEVICE:+-s "$DEVICE"} shell pm revoke "$APP_ID" android.permission.RECORD_AUDIO
    adb ${DEVICE:+-s "$DEVICE"} shell pm clear-permission-flags "$APP_ID" android.permission.RECORD_AUDIO user-fixed ;;
  android:permission-block)
    # user-fixed는 "다시 묻지 않음"이라 요청이 창 없이 즉시 거부된다.
    adb ${DEVICE:+-s "$DEVICE"} shell pm revoke "$APP_ID" android.permission.RECORD_AUDIO
    adb ${DEVICE:+-s "$DEVICE"} shell pm set-permission-flags "$APP_ID" android.permission.RECORD_AUDIO user-fixed ;;
  android:table-drop)
    # 파일을 깨뜨리면 migration이 실패해 앱이 아예 뜨지 않는다. DB는 정상으로 두고 테이블만 없애
    # 목록 조회만 실패시킨다. user_version은 그대로라 migration이 다시 만들지 않는다.
    android_db "cp $DB_DIR_ANDROID/$DB_NAME $DB_DIR_ANDROID/$DB_NAME.e2ebak"
    adb ${DEVICE:+-s "$DEVICE"} exec-out "run-as $APP_ID cat $DB_DIR_ANDROID/$DB_NAME" > "$TMP_DB"
    sqlite3 "$TMP_DB" "DROP TABLE IF EXISTS meetings;"
    adb ${DEVICE:+-s "$DEVICE"} push "$TMP_DB" "/data/local/tmp/$DB_NAME" > /dev/null
    android_db "cp /data/local/tmp/$DB_NAME $DB_DIR_ANDROID/$DB_NAME"
    android_db "rm -f $DB_DIR_ANDROID/$DB_NAME-wal $DB_DIR_ANDROID/$DB_NAME-shm"
    adb ${DEVICE:+-s "$DEVICE"} shell rm -f "/data/local/tmp/$DB_NAME" ;;
  android:table-restore)
    android_db "cp $DB_DIR_ANDROID/$DB_NAME.e2ebak $DB_DIR_ANDROID/$DB_NAME"
    android_db "rm -f $DB_DIR_ANDROID/$DB_NAME.e2ebak $DB_DIR_ANDROID/$DB_NAME-wal $DB_DIR_ANDROID/$DB_NAME-shm" ;;

  ios:permission-grant)
    xcrun simctl privacy "${DEVICE:-booted}" grant microphone "$APP_ID" ;;
  ios:permission-deny)
    # reset은 다음 사용 때 다시 묻는 상태로 되돌린다.
    xcrun simctl privacy "${DEVICE:-booted}" reset microphone "$APP_ID" ;;
  ios:permission-block)
    xcrun simctl privacy "${DEVICE:-booted}" revoke microphone "$APP_ID" ;;
  ios:table-drop)
    DIR="$(ios_container)/Documents/SQLite"
    cp "$DIR/$DB_NAME" "$DIR/$DB_NAME.e2ebak"
    sqlite3 "$DIR/$DB_NAME" "DROP TABLE IF EXISTS meetings;"
    rm -f "$DIR/$DB_NAME-wal" "$DIR/$DB_NAME-shm" ;;
  ios:table-restore)
    DIR="$(ios_container)/Documents/SQLite"
    cp "$DIR/$DB_NAME.e2ebak" "$DIR/$DB_NAME"
    rm -f "$DIR/$DB_NAME.e2ebak" "$DIR/$DB_NAME-wal" "$DIR/$DB_NAME-shm" ;;

  *) usage ;;
esac

echo "done: $PLATFORM $ACTION"
