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
  echo "          db-corrupt | table-drop | table-restore"
  echo "          meetings-seed | meetings-unseed (iOS는 실기기 UDID 필수)"
  exit 1
}

PLATFORM=${1:-}
ACTION=${2:-}
DEVICE=${3:-}
[ -z "$PLATFORM" ] || [ -z "$ACTION" ] && usage

android_db() {
  adb ${DEVICE:+-s "$DEVICE"} shell "run-as $APP_ID $1"
}

# 목록 페이지네이션 검증용 회의 25건. id 접두사로만 지우므로 실제 회의는 건드리지 않는다.
# 01이 가장 최근, 25가 가장 오래돼 목록 끝에 온다. 상세를 열지 않으므로 녹음 파일은 만들지 않는다.
SEED_SQL="
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 25)
INSERT INTO meetings (id, title, created_at_ms, updated_at_ms)
SELECT printf('e2e-seed-%02d', i), printf('E2E 페이지 %02d', i), ms, ms
FROM (SELECT i, strftime('%s', strftime('%Y', 'now') || '-01-02') * 1000 + (25 - i) * 60000 AS ms FROM n);
INSERT INTO recordings (meeting_id, relative_path, mime_type, sha256, duration_ms, byte_size)
SELECT id, 'recordings/' || id || '.m4a', 'audio/mp4', 'e2e-seed', 1000, 1 FROM meetings WHERE id LIKE 'e2e-seed-%';"
# host sqlite3는 foreign_keys가 꺼져 있어 cascade에 기대지 않고 둘 다 지운다.
UNSEED_SQL="
DELETE FROM recordings WHERE meeting_id LIKE 'e2e-seed-%';
DELETE FROM meetings WHERE id LIKE 'e2e-seed-%';"

# WAL에만 있는 최근 commit을 잃지 않도록 db·wal을 함께 꺼내 host에서 checkpoint한 뒤 본 파일만 되돌린다.
android_edit_db() {
  local dir=/tmp/echonote-e2e-android
  rm -rf "$dir" && mkdir -p "$dir"
  adb ${DEVICE:+-s "$DEVICE"} shell am force-stop "$APP_ID"
  for f in "$DB_NAME" "$DB_NAME-wal"; do
    adb ${DEVICE:+-s "$DEVICE"} exec-out "run-as $APP_ID sh -c 'cat $DB_DIR_ANDROID/$f 2>/dev/null'" > "$dir/$f"
  done
  sqlite3 "$dir/$DB_NAME" "$1 PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" > /dev/null
  adb ${DEVICE:+-s "$DEVICE"} push "$dir/$DB_NAME" "/data/local/tmp/$DB_NAME" > /dev/null
  android_db "cp /data/local/tmp/$DB_NAME $DB_DIR_ANDROID/$DB_NAME"
  android_db "rm -f $DB_DIR_ANDROID/$DB_NAME-wal $DB_DIR_ANDROID/$DB_NAME-shm"
  adb ${DEVICE:+-s "$DEVICE"} shell rm -f "/data/local/tmp/$DB_NAME"
}

ios_copy() {
  local direction=$1
  shift
  xcrun devicectl device copy "$direction" --device "$DEVICE" \
    --domain-type appDataContainer --domain-identifier "$APP_ID" "$@" > /dev/null
}

# 실기기 앱 컨테이너는 devicectl로만 읽고 쓴다. 앱은 파일을 바꾸기 전에 종료한다.
ios_device_edit_db() {
  local dir=/tmp/echonote-e2e-ios
  local pid
  [ -z "$DEVICE" ] && usage
  rm -rf "$dir" && mkdir -p "$dir"
  pid=$(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | awk '/EchoNote.app\/EchoNote/ {print $1}' | head -1)
  [ -n "$pid" ] && xcrun devicectl device process terminate --device "$DEVICE" --pid "$pid" > /dev/null
  for f in "$DB_NAME" "$DB_NAME-wal"; do
    ios_copy from --source "Documents/SQLite/$f" --destination "$dir/$f"
  done
  sqlite3 "$dir/$DB_NAME" "$1 PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" > /dev/null
  # 파일 삭제 명령이 없어 빈 wal·shm으로 덮어 이전 WAL 내용을 무효로 만든다.
  : > "$dir/$DB_NAME-wal"
  : > "$dir/$DB_NAME-shm"
  for f in "$DB_NAME" "$DB_NAME-wal" "$DB_NAME-shm"; do
    ios_copy to --source "$dir/$f" --destination "Documents/SQLite/$f"
  done
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
  android:db-corrupt)
    # DB 파일 자체를 못 읽게 만든다. migration이 실패해 복구 화면이 떠야 한다.
    android_db "cp $DB_DIR_ANDROID/$DB_NAME $DB_DIR_ANDROID/$DB_NAME.e2ebak"
    android_db "sh -c 'printf corrupted > $DB_DIR_ANDROID/$DB_NAME'"
    android_db "rm -f $DB_DIR_ANDROID/$DB_NAME-wal $DB_DIR_ANDROID/$DB_NAME-shm" ;;
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
  android:meetings-seed)
    android_edit_db "$UNSEED_SQL $SEED_SQL" ;;
  android:meetings-unseed)
    android_edit_db "$UNSEED_SQL" ;;
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
  ios:db-corrupt)
    DIR="$(ios_container)/Documents/SQLite"
    cp "$DIR/$DB_NAME" "$DIR/$DB_NAME.e2ebak"
    printf corrupted > "$DIR/$DB_NAME"
    rm -f "$DIR/$DB_NAME-wal" "$DIR/$DB_NAME-shm" ;;
  ios:table-drop)
    DIR="$(ios_container)/Documents/SQLite"
    cp "$DIR/$DB_NAME" "$DIR/$DB_NAME.e2ebak"
    sqlite3 "$DIR/$DB_NAME" "DROP TABLE IF EXISTS meetings;"
    rm -f "$DIR/$DB_NAME-wal" "$DIR/$DB_NAME-shm" ;;
  ios:meetings-seed)
    ios_device_edit_db "$UNSEED_SQL $SEED_SQL" ;;
  ios:meetings-unseed)
    ios_device_edit_db "$UNSEED_SQL" ;;
  ios:table-restore)
    DIR="$(ios_container)/Documents/SQLite"
    cp "$DIR/$DB_NAME.e2ebak" "$DIR/$DB_NAME"
    rm -f "$DIR/$DB_NAME.e2ebak" "$DIR/$DB_NAME-wal" "$DIR/$DB_NAME-shm" ;;

  *) usage ;;
esac

echo "done: $PLATFORM $ACTION"
