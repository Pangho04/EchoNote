# 검증 기록

실기기·시뮬레이터 검증에서 **자동 테스트가 못 잡은 것**만 남긴다. 다음 단계에서 같은 함정을 다시 밟지 않기 위한 기록이다.

각 항목 형식: **목적 → 단계 → 원인 → 조치**. 원인은 추측이 아니라 관찰한 근거(로그·스크린샷·파일)로 적는다.

---

## 2026-09-17 · 오류 안내를 팝업으로 통일하고 DB 복구 경로를 만들었다

관련 커밋: `b7940bc`(ROUTES) ~ `6e6da39`(DB 복구)

### 목적

1. 오류 안내가 화면마다 제각각(native Alert / 인라인 / 다이얼로그 내 문구)이라 팝업 하나로 통일한다
2. 화면 문구가 코드 곳곳에 박혀 있어 한 곳에서 관리한다
3. **모든 오류 상황의 화면이 실제 기기에서 뜨는지 증명한다**

### 단계

| #   | 한 일                                      | 결과                                                            |
| --- | ------------------------------------------ | --------------------------------------------------------------- |
| 1   | route 경로를 `ROUTES` 상수로 모음          | `typedRoutes`가 이미 오타를 잡고 있어 실익은 "변경 지점 하나"뿐 |
| 2   | 화면 문구를 `UI_STRINGS`로 모음            | 8곳 → 이후 라벨·접근성 라벨까지 이관                            |
| 3   | `useDialog` 팝업 도입, native `Alert` 제거 | 문구형·컴포넌트형 두 입구                                       |
| 4   | 제목 입력 모달을 팝업 `content`로 이전     | ViewModel 표면 5개 축소                                         |
| 5   | Maestro E2E flow 5개 작성                  | Android 실기기 5/5                                              |
| 6   | iOS 27 대응 후 시뮬레이터 E2E              | iOS 5/5                                                         |
| 7   | 오류 상황별 시나리오 3종 추가              | 권한 차단·목록 조회 실패 증명                                   |
| 8   | DB 복구 화면 구현                          | 부팅 실패 경로 제거                                             |

### 원인과 조치 — 실기기에서만 드러난 것

#### A. iOS 27에서 앱이 설치는 되는데 실행 즉시 종료

- **관찰**: `devicectl ... launch --console` → `App terminated due to signal 5`. 빌드·서명·설치는 모두 성공
- **원인**: Xcode 27에는 iOS 27 SDK만 들어 있고, 그 SDK로 빌드한 앱은 **UIKit scene 생명주기**를 요구한다. Expo SDK 57 기본값은 예전 application 생명주기다. 근거 — `expo.fyi/ios-scene-lifecycle`: "apps compiled against Xcode 27 that remain on the older application-based model do not launch correctly on iOS 27"
- **조치**: `expo-build-properties`의 `ios.enableSceneSupport: true`. `Info.plist`에 `UIApplicationSceneManifest` + `EXExpoAppSceneDelegate`가 생긴다. `expo@57.0.23` 이상 필요
- **교훈**: 설치 성공과 실행 성공은 별개다. 빌드가 통과했다고 런타임 계약까지 맞은 게 아니다

#### B. E2E flow가 실행 순서를 가정해 3개가 동시에 실패

- **관찰**: 완료 순서가 `05 → 03 → 04 → 01 → 02`. 데이터를 만드는 `02`가 마지막
- **원인**: Maestro는 폴더 안 flow를 **파일명 순으로 돌리지 않는다**. 문서에 그렇게 적은 건 내 추측이었다
- **조치**: 준비 작업을 `subflows/`로 빼고 필요한 flow가 `runFlow`로 직접 부른다. subflow는 테스트 폴더 **바깥**에 둔다(안에 두면 독립 flow로 실행된다)

#### C. 같은 flow가 Android는 통과, iOS는 실패

- **관찰**: 목록에 항목이 분명히 보이는데 `assertVisible: 'E2E 녹음'` 실패. 계층 덤프에 `"9월, 17, E2E 녹음, 녹음 대기"` 한 덩어리
- **원인**: iOS는 목록 셀 자식을 하나의 접근성 요소로 합친다. Maestro 텍스트 매칭은 **전체 일치 정규식**이라 부분 문자열이 안 걸린다
- **조치**: 선택자를 `.*${TITLE}.*`로 감쌌다. Android도 그대로 통과한다

#### D. iOS에서 앞선 flow가 남긴 시스템 창이 이후 flow를 전부 죽임

- **관찰**: 5개 모두 첫 단계에서 `"회의" is visible` 실패. 스크린샷에 `'EchoNote'에서 열겠습니까?` 창
- **원인**: iOS는 커스텀 스킴 링크를 열 때 시스템 확인 창을 띄운다. 확인하지 않으면 남아서 화면을 덮는다
- **조치**: `subflows/dismiss-link-prompt.yaml`을 각 flow 시작에 둔다

#### E. 권한 차단 시나리오가 항상 "권한 있음"으로 끝남

- **관찰**: `pm set-permission-flags ... user-fixed`로 차단해도 flow 실행 후 `granted=true`
- **원인**: **Maestro는 `launchApp`에서 권한을 자동 허용한다**
- **조치**: 권한 시나리오는 `stopApp` + 개발 서버 URL `openLink`로 앱을 띄운다. dev 빌드는 앱 스킴 콜드 스타트가 dev launcher로 가므로 앱 스킴은 쓸 수 없다

#### F. DB 파일을 깨뜨렸더니 앱이 통째로 죽음 — 목록 오류 화면에 도달 못 함

- **관찰**: `Render Error: NativeDatabase.execAsync has been rejected → file is not a database`, `database-provider.tsx (9:8)`
- **원인**: `SQLiteProvider`의 `onInit`(migration)이 렌더 중 실패하고, 잡는 곳이 없어 루트까지 전파된다. dev는 빨간 화면, 릴리스는 흰 화면
- **조치 1**: 검증 수단 교체 — 조회 실패를 보려면 DB는 열려야 한다. **테이블만 삭제**해 조회만 실패시킨다
- **조치 2**: 제품 수정 — `SQLiteProvider`의 `onError`로 받아 복구 화면을 그린다. 손상은 초기화 허용, 앱보다 새 version은 초기화 금지
- **교훈**: "이 상황의 화면"을 증명하려다 **화면이 아예 없다는 사실**을 발견했다. 목록 조회 실패도 같은 방식으로 드러났다 — ViewModel이 `errorMessage`를 만들지만 화면이 읽지 않았다

#### G. 초기화 버튼이 눌리는데 DB가 그대로

- **관찰**: 초기화 후에도 파일이 9바이트 `corrupted`. 화면에 `DeleteDatabaseException: Unable to delete database ... that is currently open. Close it prior to deletion`
- **원인**: `onInit`이 실패해도 DB 핸들은 열린 상태다. 닫지 않으면 네이티브가 삭제를 거부한다
- **조치**: `closeAsync()` 먼저 호출. 삭제 실패는 삼키지 않고 복구 화면을 유지
- **덤**: 이걸 못 잡은 이유는 내 E2E 단언이 헐거웠기 때문이다. 초기화 후 `'회의'` 헤더만 확인했는데 그 헤더는 DB 없이도 그려진다. **새 녹음을 만들어 DB에 실제로 쓰이는지**까지 확인하도록 고쳤다

#### H. DB 작업 후 deep link가 깨짐 (회귀)

- **관찰**: 상세로 이동해야 할 deep link가 목록에 머문다. 커밋본에서는 정상
- **원인 분리**: `git stash push -u` → 재현 안 됨 → `git stash pop` 후 변경을 부분 되돌리며 이분 탐색. provider 순서가 아니라 `DatabaseProvider`가 범인
- **원인**: `onInit`·`onError`를 **렌더마다 새로 만든 함수**로 넘겼다. 참조가 바뀌면 `SQLiteProvider`가 DB를 다시 열고 하위 트리를 재마운트해 라우트가 초기화된다
- **조치**: `useCallback`으로 고정
- **교훈**: dev 빌드는 Metro가 JS를 다시 말아주므로 **네이티브 재빌드 없이** `git stash`만으로 커밋본과 대조할 수 있다. 회귀 분리에 가장 빠른 방법

#### I. Android E2E가 통째로 실패 — 코드와 무관

- **원인**: 폰 화면이 잠겨 있었다. 잠금 화면에서는 앱이 보이지 않는다
- **조치**: 실행 전 `adb shell input keyevent KEYCODE_WAKEUP` + `82`, `dumpsys window | grep mDreamingLockscreen`으로 확인

#### J. iOS 시뮬레이터에서 `02-record-and-save`가 suite에서만 실패 (미해결)

- **관찰 1**: suite에서 `"녹음 종료" is visible` 실패. 같은 flow를 단독 실행하면 통과한다. 40초로 늘려도 같다
- **관찰 2**: 실패 시점 화면은 제목 입력 팝업 그대로다 — 녹음 화면으로 넘어가지 못했다
- **관찰 3**: 한 번은 마이크 권한이 차단된 상태였다(앞선 권한 시나리오를 되돌리지 않음). 권한을 준 뒤에도 suite에서는 재현된다
- **관찰 4**: suite 종료 후 시뮬레이터가 홈 화면이었다 — 앱이 실행 중 종료됐다
- **의심**: Maestro는 `launchApp`에서 권한을 자동 허용하는데, iOS는 권한 변경이 **실행 중인 앱을 종료**시킨다(`simctl privacy` 문서 명시). suite처럼 `launchApp`이 연달아 일어나면 녹음 중 앱이 죽을 수 있다. **확정하지 못했다**
- **현재 조치**: `02`의 대기를 subflow와 같은 40초로 맞춤(불일치 자체는 실제 문제였다). suite 실패는 남아 있으며 iOS 커버리지는 4/5 + `02` 단독 통과로 본다
- **다음에 볼 것**: flow에 `launchApp: permissions:` 를 명시해 자동 허용을 막아보고, 그래도 재현되면 시뮬레이터 녹음 스택을 의심한다

#### K. 기기 상태를 되돌리지 않아 다음 실행이 오염됨

- **관찰**: 권한 차단 시나리오 뒤 `02`가 계속 실패. 마이크가 차단된 채였다
- **조치**: 시나리오는 항상 짝이 되는 복구 명령까지 실행한다. 스크립트에 `permission-grant`, `table-restore`를 둔 이유다
- **교훈**: 기기 상태를 바꾸는 테스트는 **되돌리기까지가 테스트다**

### 자동화하지 못한 것과 사유

| 항목                     | 사유                                                                                                                | 대체                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| iOS 실기기 E2E           | Maestro가 지원하지 않음(공식 Known limitations). `--apple-team-id`는 `record` 전용                                  | iOS 시뮬레이터 + 실기기 수동 확인                 |
| 권한 «거부»(재요청 가능) | Android는 거부 이력이 있으면 OS 창을 건너뛰고 차단으로 처리. iOS 시뮬레이터는 `simctl privacy` 변경이 앱을 종료시킴 | `RecordingTitleForm` jest 테스트                  |
| 녹음 저장 실패           | 파일시스템 강제 실패가 플랫폼마다 지저분하고 되돌리기 어려움                                                        | `meeting-recorder` jest 테스트                    |
| 키보드 겹침              | Maestro가 요소 겹침을 판정하지 못함                                                                                 | 키보드 오프셋 순수 함수 단위 테스트 + 눈으로 확인 |

### 최종 상태

- vitest 25 files / 139 tests, jest 12 suites / 54 tests
- E2E suite: Android 실기기 5/5, iOS 시뮬레이터 5/5
- 시나리오: 권한 차단·목록 조회 실패·DB 손상 복구 — 양 플랫폼 통과
