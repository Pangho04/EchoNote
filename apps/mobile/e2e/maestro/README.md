# 실기기 E2E (Maestro)

선택자는 `src/shared/config/ui-strings.ts`의 문구와 `accessibilityLabel`을 그대로 쓴다. 문구를 바꾸면 이 flow도 같이 고친다.

대상 플랫폼 둘 다 실측으로 5/5 통과한다 — Android 실기기(SM-F731N / Android 16), iOS 시뮬레이터(iPhone 17 Pro / iOS 26.5).

**iOS 실기기는 Maestro가 지원하지 않는다.** 공식 문서의 Known limitations에 "Physical Devices … not supported yet"으로 적혀 있고, `--apple-team-id`는 `record` 명령 전용이라 team ID를 줘도 드라이버 빌드에서 막힌다. iOS는 시뮬레이터로 돌리고, 실기기는 `docs/testing/device-check-dialog.md`로 눈으로 본다.

## 준비

기기 1대만 연결한다. 여러 대면 `--device`로 지정해야 한다.

```bash
# Android 무선
adb pair <IP>:<페어링포트>
adb connect <IP>:<디버깅포트>
adb devices -l

# 마이크 권한 미리 허용 (02가 시스템 다이얼로그를 다루지 않는다)
adb shell pm grant dev.pangho.echonote android.permission.RECORD_AUDIO
```

iOS는 개발자 프로파일을 기기에서 신뢰한 뒤(설정 → 일반 → VPN 및 기기 관리) 한 번 직접 실행해 마이크 권한을 허용해 둔다.

## 실행

```bash
pnpm -F mobile e2e              # 연결된 기기가 하나일 때
maestro --device <udid> test e2e/maestro          # 기기가 여럿일 때 지정
xcrun simctl list devices available | grep iPhone # 시뮬레이터 udid 확인
maestro test e2e/maestro/04-detail-missing.yaml   # 단건
maestro studio                  # 선택자 탐색
```

Metro가 떠 있어야 한다. 없으면 `pnpm -F mobile start`를 먼저 실행한다.

## flow와 의존

| 파일                        | 다루는 것                                 | 선행        |
| --------------------------- | ----------------------------------------- | ----------- |
| `01-recording-dialog.yaml`  | 제목 팝업 표시, 바깥 탭으로 안 닫힘, 취소 | 없음        |
| `02-record-and-save.yaml`   | 녹음 → 종료 → 저장 토스트 → 목록 반영     | 마이크 권한 |
| `03-detail-navigation.yaml` | 목록 → 상세 → 뒤로                        | 없음        |
| `04-detail-missing.yaml`    | deep link로 없는 ID → 오류 팝업           | 없음        |
| `05-persistence.yaml`       | 앱 종료 후 재조회                         | 없음        |

**Maestro는 폴더 안 flow를 파일 이름 순으로 실행하지 않는다.** 실측에서 `05 → 03 → 04 → 01 → 02` 순으로 돌았다. 그래서 회의 데이터가 필요한 flow는 `subflows/create-recording.yaml`을 `runFlow`로 불러 스스로 준비한다. 그 subflow는 회의가 이미 보이면 아무것도 하지 않는다.

`subflows/`는 `e2e/maestro/` 바깥에 둔다. 안에 두면 그 자체가 독립 flow로 실행된다.

모든 flow가 `clearState: false`다. `true`로 두면 SQLite가 지워져 `05`의 재조회 검증이 성립하지 않는다. 기기 데이터를 비우려면 앱을 지우고 다시 설치한다.

dev client는 번들을 받아 첫 화면을 그리기까지 시간이 걸린다. 모든 flow가 `회의` 헤더를 30초까지 기다린 뒤 조작을 시작한다. 타임아웃을 10초로 줄이면 `04`가 간헐적으로 실패한다.

## 플랫폼 차이로 flow에 넣은 장치

| 장치                                   | 이유                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 제목 선택자를 `.*${TITLE}.*` 로 감쌈   | iOS는 목록 셀 자식을 하나의 접근성 요소로 합친다(`"9월, 17, E2E 녹음, 녹음 대기"`). Maestro는 전체 일치 정규식이라 부분 문자열이 매칭되지 않는다 |
| `hideKeyboard`를 Android에서만 실행    | iOS 시뮬레이터는 Mac 하드웨어 키보드를 쓰므로 내릴 소프트 키보드가 없고, 호출하면 실패한다                                                       |
| 모든 flow 시작에 `dismiss-link-prompt` | iOS는 커스텀 스킴 링크에 시스템 확인 창(`열기`)을 띄운다. 앞선 flow가 남기면 화면 전체를 덮어 이후 flow가 모두 실패한다                          |
| 대기 30~40초                           | dev client 번들 로드와 시뮬레이터 녹음 시작이 실기기보다 느리다                                                                                  |

## 실행 전 확인

**Android 기기 화면이 꺼져 있으면 전부 실패한다.** 잠금 화면에서는 앱이 보이지 않는다.

```bash
adb shell input keyevent KEYCODE_WAKEUP
adb shell input keyevent 82
```

## 기기 상태가 필요한 시나리오 (`../scenarios`)

권한과 DB 상태는 flow 안에서 바꿀 수 없어 `e2e/device-state.sh`로 준비한 뒤 단건 실행한다. suite 폴더 밖에 두어 순서 무작위 실행에 섞이지 않게 했다.

```bash
# 권한 차단 안내
./e2e/device-state.sh android permission-block <device>
maestro --device <device> test e2e/scenarios/permission-blocked.yaml
./e2e/device-state.sh android permission-grant <device>

# 목록 조회 실패 팝업
./e2e/device-state.sh ios table-drop <simulator-udid>
maestro --device <simulator-udid> test e2e/scenarios/list-load-failed.yaml
./e2e/device-state.sh ios table-restore <simulator-udid>
```

두 시나리오 모두 Android 실기기·iOS 시뮬레이터에서 통과를 확인했다.

**`launchApp`을 쓰지 않는 이유** — Maestro는 앱을 실행할 때 권한을 자동으로 허용한다. 권한 시나리오에서 `launchApp`을 쓰면 차단 상태가 풀려버려 `stopApp` + 개발 서버 URL `openLink`로 띄운다. 개발 PC가 바뀌면 `-e DEV_CLIENT_URL=...`로 덮어쓴다.

**DB 파일을 깨뜨리지 않고 테이블만 지우는 이유** — 파일을 훼손하면 `SQLiteProvider`의 `onInit` migration이 실패해 앱이 아예 뜨지 않는다. 목록 조회 실패 화면에 도달하려면 DB는 열려야 한다.

## 함께 보는 문서

- `../JOURNAL.md` — 검증에서 드러난 문제와 조치 기록. 같은 함정을 다시 밟지 않기 위한 것
- `../FOLLOW-UPS.md` — 지금 고치지 않기로 판단한 것과 그 사유
- `device-e2e` 스킬 — 기기 연결·상태 조작·실패 원인 분리 절차

## 자동화하지 않는 것

**마이크 권한 «거부»(재요청 가능) 상태.** 차단은 위 시나리오로 자동화했지만 거부는 양쪽 다 막힌다 — Android는 거부 이력이 남은 기기에서 OS 창을 건너뛰고 곧장 차단으로 처리하고, iOS 시뮬레이터는 `simctl privacy` 변경이 앱을 종료시켜 거부 직후 화면을 확인할 수 없다. `RecordingTitleForm`의 jest 테스트가 denied 분기를 덮고, 실제 화면은 `docs/testing/device-check-dialog.md` B절로 본다.

**녹음 저장 실패.** 파일 시스템을 실패시키는 조작이 플랫폼마다 지저분하고 되돌리기 어렵다. `meeting-recorder`의 인라인 오류 표시는 jest가 덮는다.

**키보드가 버튼을 가리는지.** Maestro는 겹침을 판정하지 못한다. 같은 문서 A2·A3으로 눈으로 본다.
