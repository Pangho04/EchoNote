# 실기기 E2E (Maestro)

선택자는 `src/shared/config/ui-strings.ts`의 문구와 `accessibilityLabel`을 그대로 쓴다. 문구를 바꾸면 이 flow도 같이 고친다.

실측으로 11/11 통과한다 — Android 실기기(SM-F731N / Android 16) 2회 연속, iPhone 12 mini 실기기(iOS 27.0, maestro-runner) 2회 연속 모두 11/11. iOS 시뮬레이터(iPhone 17 Pro / iOS 26.5)는 시작 규칙과 재생 중 seek 검증을 넣기 전 판에서 6/6을 확인했다. `16-export-meeting-file.yaml`은 현재 판을 단독 실행해 Android·iPhone 12 mini에서 1회씩 통과했다.

**iOS 실기기는 공식 Maestro가 지원하지 않는다.** 공식 문서의 Known limitations에 "Physical Devices … not supported yet"으로 적혀 있다. 실기기는 오픈소스 대체 러너 [maestro-runner](https://github.com/devicelab-dev/maestro-runner)(Apache-2.0, DeviceLab)로 같은 flow를 돌린다. 아래 「iPhone 실기기」 절을 본다.

## 준비

기기 1대만 연결한다. 여러 대면 `--device`로 지정해야 한다.

```bash
# Android 무선
adb pair <IP>:<페어링포트>
adb connect <IP>:<디버깅포트>
adb devices -l

# 마이크 권한 미리 허용 (flow가 시스템 다이얼로그를 다루지 않는다)
adb shell pm grant dev.pangho.echonote.dev android.permission.RECORD_AUDIO
```

iOS는 개발자 프로파일을 기기에서 신뢰한 뒤(설정 → 일반 → VPN 및 기기 관리) 한 번 직접 실행해 마이크 권한을 허용해 둔다.

양쪽 모두 개발 메뉴의 `Tools button`을 끈다. 떠 있는 톱니바퀴 버튼이 헤더의 `취소`·`‹ 회의`·`로그아웃` 위에 오면 Maestro가 그 버튼을 눌러 flow가 실패한다. 끈 뒤에는 기기를 흔들어 개발 메뉴를 연다.

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

| 파일                          | 다루는 것                                                                                  | 선행        |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `01-recording-dialog.yaml`    | 제목 팝업 표시, 바깥 탭으로 안 닫힘, 취소                                                  | 없음        |
| `04-detail-missing.yaml`      | deep link로 없는 ID → 오류 팝업                                                            | 없음        |
| `06-gate-a-full.yaml`         | 녹음 → 일시정지·재개 → 30초 → 저장 토스트 → 재시작 → 상세 → seek·재생 → 뒤로 → 밀어서 삭제 | 마이크 권한 |
| `07-recording-cancel.yaml`    | 녹음 중 취소 → 계속 녹음 → 버리기 → 목록                                                   | 마이크 권한 |
| `09-meeting-bulk-delete.yaml` | 선택 → 두 행 선택 → 삭제 → 확인 → 편집 해제                                                | 마이크 권한 |
| `10-meeting-year-filter.yaml` | 작년 선택 시 올해 회의 빠짐 → 올해로 복귀                                                  | 마이크 권한 |
| `11-sign-out-sign-in.yaml`    | 로그아웃 → 로그아웃 상태 링크 차단 → 틀린 비밀번호 오류 → 로그인                           | 계정        |
| `12-unknown-path.yaml`        | 없는 경로 링크 → 목록 (앱 실행 중, 목록이 안 쌓이는지는 jest가 확인)                       | 계정        |
| `14-meeting-rename.yaml`      | 상세 → 연필 → 이름 저장 → 목록에 바뀐 이름                                                 | 마이크 권한 |
| `15-upload-recording.yaml`    | 메뉴 → 업로드 → `EchoNote-E2E` 폴더의 `e2e-upload.m4a` 선택 → 상세에 녹음 길이             | 업로드 파일 |
| `16-export-meeting-file.yaml` | 상세 → 저장 → 시스템 저장 화면 취소 → 다시 저장 → 「저장했습니다」                         | 마이크 권한 |

**Maestro는 폴더 안 flow를 파일 이름 순으로 실행하지 않는다.** 실측에서도 파일 이름과 다른 순서로 돌았다. 그래서 회의 데이터가 필요한 flow는 `subflows/create-recording.yaml`을 `runFlow`로 불러 스스로 준비한다. 그 subflow는 회의가 이미 보이면 아무것도 하지 않는다. 제목은 호출한 flow의 `TITLE`을 쓰며, subflow에 `env` 기본값을 두면 호출부 값을 덮어쓰므로 두지 않는다.

**제목은 실행마다 새로 만들고, 만든 회의는 그 flow가 지운다.** 회의를 만드는 flow는 `evalScript`로 `'접두사 ' + (Date.now() % 100000)` 제목을 정하고, 끝에서 `subflows/delete-meeting.yaml`로 자기 회의를 지운다. 고정 제목을 쓰면 중단된 실행이 남긴 같은 제목의 행 때문에 `create-recording`이 새로 만들지 않고 넘어가거나 삭제 뒤 확인이 실패한다.

`subflows/`는 `e2e/maestro/` 바깥에 둔다. 안에 두면 그 자체가 독립 flow로 실행된다.

모든 flow가 `clearState: false`다. `true`로 두면 SQLite가 지워져 `06`의 재시작 뒤 재조회 검증이 성립하지 않는다. 기기 데이터를 비우려면 앱을 지우고 다시 설치한다.

**모든 flow는 `subflows/start-at-list.yaml`로 시작한다.** 앱을 끄고 다시 띄워 목록 화면(`메뉴 열기` 버튼)이 보일 때까지 30초까지 기다린다. 앞 flow가 어느 화면에서 끝났는지에 기대지 않으려고 끝날 때 정리하지 않고 시작할 때 맞춘다. 새 flow도 첫 단계로 이 subflow를 부른다. dev client 번들 로드 때문에 타임아웃을 10초로 줄이면 `04`가 간헐적으로 실패한다.

**계정은 실행할 때 넘긴다.** `start-at-list`는 로그인 화면이 뜨면 `subflows/sign-in.yaml`로 로그인한다. 계정은 저장소 밖 `~/.echonote-e2e.env`(`E2E_EMAIL`·`E2E_PASSWORD` 두 줄, `chmod 600`)에 두고 `-e`로 넘긴다. 러너가 입력값을 로그에 찍을 수 있으니 출력을 공유하기 전에 확인한다.

```bash
set -a; . ~/.echonote-e2e.env; set +a
maestro test -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" e2e/maestro
```

**녹음을 만든 뒤에는 상세 화면이 뜬다.** 저장하면 상세로 바뀌고 자동 변환 요청이 시작된다. `create-recording`은 목록으로 돌아와 끝난다. 상세에 머물러야 하는 시나리오는 녹음 단계를 직접 적는다.

## 업로드 파일 준비

`15`는 기기에 `e2e-upload.m4a`가 있어야 한다. 앱이 저장한 테스트 녹음 하나를 꺼내 넣는다. 저장소에는 넣지 않는다.

```bash
# Android: 앱 녹음 하나를 꺼내 다운로드 아래 전용 폴더에 둔다. 다운로드 폴더 바로 아래에 두면 다른 파일이 쌓일 때 첫 화면 밖으로 밀린다
adb exec-out run-as dev.pangho.echonote.dev ls files/recordings
adb exec-out run-as dev.pangho.echonote.dev cat files/recordings/<id>.m4a > /tmp/e2e-upload.m4a
adb push /tmp/e2e-upload.m4a /sdcard/Download/EchoNote-E2E/e2e-upload.m4a
```

iPhone은 파일 앱의 「나의 iPhone」에 같은 이름으로 둔다. 개발 도구로 그 폴더에 직접 복사할 수 없어(`devicectl copy`가 컨테이너를 찾지 못함) AirDrop 등으로 넣는다. 파일 선택 창은 Android `루트 표시 → 다운로드 → EchoNote-E2E`, iOS `둘러보기 → 나의 iPhone` 순으로 연다.

## 플랫폼 차이로 flow에 넣은 장치

| 장치                                                     | 이유                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 제목 선택자를 `.*${TITLE}.*` 로 감쌈                     | iOS는 목록 셀 자식을 하나의 접근성 요소로 합친다(`"9월, 17, E2E 녹음, 녹음 대기"`). Maestro는 전체 일치 정규식이라 부분 문자열이 매칭되지 않는다                                                                                                     |
| `hideKeyboard`를 Android에서만 실행                      | iOS 시뮬레이터는 Mac 하드웨어 키보드를 쓰므로 내릴 소프트 키보드가 없고, 호출하면 실패한다                                                                                                                                                           |
| 모든 flow 시작에 `dismiss-link-prompt`                   | iOS는 커스텀 스킴 링크에 시스템 확인 창(`열기`)을 띄운다. 앞선 flow가 남기면 화면 전체를 덮어 이후 flow가 모두 실패한다                                                                                                                              |
| 로그인은 버튼 대신 `pressKey: Enter`로 제출              | iPhone 12 mini에서 `로그인` 버튼 좌표가 키보드 위 암호 자동 완성 막대와 겹쳐 그쪽을 누른다                                                                                                                                                           |
| 로그인 화면 판별을 `.*이용 문의.*`로                     | iOS는 문의 링크를 화면 문장이 아니라 접근성 라벨(`이용 문의 메일 쓰기, …`)로 노출한다                                                                                                                                                                |
| iOS 실행에 `--typing-frequency 10`                       | 기본 초당 30타로는 실기기에서 `inputText`가 글자를 빠뜨린다(`Gate A` → `Gte A`). 10에서도 가끔 빠뜨려 `create-recording`은 제목이 안 보이면 한 번 다시 쓴다                                                                                          |
| 삭제 flow 제목에 `삭제`·`확인`·`선택`·`취소`를 넣지 않음 | maestro-runner의 텍스트 선택자가 부분 일치라 팝업 버튼 대신 제목 행을 누른다. 선택·삭제 버튼은 접근성 라벨(`선택 시작`·`선택한 회의 삭제`)로 누른다                                                                                                  |
| 스와이프 삭제 버튼을 `meeting-row-delete` id로 누름      | Android 요소 목록에는 닫힌 행 뒤에 숨긴 삭제 버튼도 잡혀, `삭제` 텍스트로 누르면 다른 행을 누른다. id는 열린 행의 버튼에만 붙는다                                                                                                                    |
| 대기 30~40초                                             | dev client 번들 로드와 시뮬레이터 녹음 시작이 실기기보다 느리다                                                                                                                                                                                      |
| 재생 중 탭에 `waitToSettleTimeoutMs: 500`                | 재생 위치 표시가 계속 바뀌어 탭이 화면 안정을 기다리느라 한 번에 10초 넘게 늦어진다. 위치는 `copyTextFrom`으로 두 번 읽고 그사이 흐른 시간을 빼서 seek 폭을 ±4초로 판정한다. iPhone에서 `copyTextFrom` 한 번이 2초 넘게 걸려 읽기 시점 오차가 커진다 |

## 실행 전 확인

`pnpm -F mobile e2e`는 `e2e/preflight.sh`를 먼저 돌린다. 기기 연결, Metro, **폰의 Tailscale 연결, Windows Worker 응답**을 확인하고 하나라도 실패하면 시작하지 않는다. 회의가 생기면 앱이 곧바로 Worker에 녹음을 보내는데, 닿지 않으면 「데스크탑에 연결할 수 없습니다」 팝업이 화면을 덮어 녹음과 무관한 flow까지 실패한다. `maestro test`를 직접 부를 때도 이 스크립트를 먼저 돌린다.

**Android 기기 화면이 꺼져 있으면 전부 실패한다.** 잠금 화면에서는 앱이 보이지 않는다.

```bash
adb shell input keyevent KEYCODE_WAKEUP
adb shell input keyevent 82
```

## iPhone 실기기 (maestro-runner)

릴리스 tarball을 받아 `.sha256`으로 대조한 뒤 압축을 풀어 `bin/maestro-runner`를 PATH에 둔다. iPhone은 개발자 모드를 켜고 Mac을 신뢰한 상태로 USB 연결하며, 실행 중에는 잠금을 풀어 둔다.

```bash
# dev client를 개발 서버에 붙여 앱 본체를 띄운다
xcrun devicectl device process launch --terminate-existing --device <udid> \
  --payload-url "exp+echonote://expo-development-client/?url=http%3A%2F%2F<MAC_IP>%3A8081" dev.pangho.echonote.dev

maestro-runner --platform ios --device <udid> --team-id <TEAM_ID> \
  --wda-bundle-id <고유 번들 ID> --output /tmp/maestro-runner \
  test --typing-frequency 10 --env-file ~/.echonote-e2e.env e2e/maestro
```

| 막히는 곳                                                                                   | 조치                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `com.facebook.WebDriverAgentRunner.xctrunner cannot be registered to your development team` | `--wda-bundle-id`로 팀에 등록 가능한 고유 ID를 준다                                                                                                                                         |
| Xcode 27: `IPHONEOS_DEPLOYMENT_TARGET is set to 12.0 … supported 15.0 to 27.0.x`            | 러너에 들어 있는 `drivers/ios/WebDriverAgent/WebDriverAgent.xcodeproj/project.pbxproj`의 배포 타깃을 `15.0`으로 올린다. 러너를 다시 설치하면 되돌아간다                                     |
| 기기를 바꾼 뒤 WDA 재설치만 반복되고 테스트가 시작되지 않음                                 | WDA 빌드 캐시(`~/.maestro-runner/cache/wda-builds/`)가 기기와 무관한 키를 써서 옛 프로파일로 서명된 WDA를 재사용한다. 해당 캐시 디렉터리를 지우면 새 기기가 포함된 프로파일로 다시 빌드한다 |
| 리포트가 작업 디렉터리 `reports/`에 쌓임                                                    | `--output`으로 저장소 밖을 지정한다                                                                                                                                                         |

**공식 Maestro와 동작이 다른 점** — `launchApp`이 떠 있는 앱을 다시 시작하지 않아 앞 flow의 화면에서 출발한다. 텍스트 선택자가 부분 일치라서 `'회의'`가 `회의 기록`에도 맞는다. 시작 subflow가 `stopApp`을 먼저 하고 목록에만 있는 `메뉴 열기`를 기다리는 이유다. 바뀐 문구에 `notVisible`을 걸면 사라진 뒤에도 보인다고 판정한다. 그래서 「위치가 바뀌었다」는 사라짐 대신 다음 위치 후보가 보이는지(`visible` 정규식)로 기다린다. 없는 요소를 `optional`로 기다려 시간을 보내면 리포트가 실패 건수에 세므로, 화면 변화가 없는 대기는 `evalScript` 안에서 보낸다.

## 기기 상태가 필요한 시나리오 (`../scenarios`)

권한과 DB 상태는 flow 안에서 바꿀 수 없어 `e2e/device-state.sh`로 준비한 뒤 단건 실행한다. suite 폴더 밖에 두어 순서 무작위 실행에 섞이지 않게 했다. 이 시나리오들은 `start-at-list`를 쓰지 않아 로그인을 자동으로 하지 않는다. suite를 한 번 돌려 로그인된 상태에서 실행한다.

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

**데스크탑 꺼짐(`transcription-desktop-offline.yaml`)** 은 Windows Worker가 꺼진 상태를 전제한다. 켜져 있으면 변환이 끝나 실패하므로 suite에서 빼고, Worker를 끈 뒤 단건으로 실행한다.

**`launchApp`을 쓰지 않는 이유** — Maestro는 앱을 실행할 때 권한을 자동으로 허용한다. 권한 시나리오에서 `launchApp`을 쓰면 차단 상태가 풀려버려 `stopApp` + 개발 서버 URL `openLink`로 띄운다. 개발 PC가 바뀌면 `-e DEV_CLIENT_URL=...`로 덮어쓴다.

**DB 파일을 깨뜨리지 않고 테이블만 지우는 이유** — 파일을 훼손하면 `SQLiteProvider`의 `onInit` migration이 실패해 앱이 아예 뜨지 않는다. 목록 조회 실패 화면에 도달하려면 DB는 열려야 한다.

## 함께 보는 문서

- `../JOURNAL.md` — 검증에서 드러난 문제와 조치 기록. 같은 함정을 다시 밟지 않기 위한 것
- `../../../../docs/BACKLOG.md` — 지금 고치지 않기로 판단한 것과 그 사유
- `device-e2e` 스킬 — 기기 연결·상태 조작·실패 원인 분리 절차

## 자동화하지 않는 것

**마이크 권한 «거부»(재요청 가능) 상태.** 차단은 위 시나리오로 자동화했지만 거부는 양쪽 다 막힌다 — Android는 거부 이력이 남은 기기에서 OS 창을 건너뛰고 곧장 차단으로 처리하고, iOS 시뮬레이터는 `simctl privacy` 변경이 앱을 종료시켜 거부 직후 화면을 확인할 수 없다. `RecordingTitleForm`의 jest 테스트가 denied 분기를 덮고, 실제 화면은 `private-docs/testing/device-check-dialog.md` B절로 본다.

**녹음 저장 실패.** 파일 시스템을 실패시키는 조작이 플랫폼마다 지저분하고 되돌리기 어렵다. `meeting-recorder`의 인라인 오류 표시는 jest가 덮는다.

**키보드가 버튼을 가리는지.** Maestro는 겹침을 판정하지 못한다. 같은 문서 A2·A3으로 눈으로 본다.
