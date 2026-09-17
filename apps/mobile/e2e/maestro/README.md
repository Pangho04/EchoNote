# 실기기 E2E (Maestro)

선택자는 `src/shared/config/ui-strings.ts`의 문구와 `accessibilityLabel`을 그대로 쓴다. 문구를 바꾸면 이 flow도 같이 고친다.

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
pnpm -F mobile e2e              # 전체 (실측 2분 46초)
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

## 자동화하지 않는 것

**마이크 권한 거부·차단 시나리오.** OS 시스템 다이얼로그라 버튼 문구가 로케일·OS 버전마다 다르고, Android는 두 번 거부해야 차단으로 바뀌는 등 상태 조작이 기기에 묶인다. `docs/testing/device-check-dialog.md` B절의 수동 절차로 확인한다.

**키보드가 버튼을 가리는지.** Maestro는 겹침을 판정하지 못한다. 같은 문서 A2·A3으로 눈으로 본다.
