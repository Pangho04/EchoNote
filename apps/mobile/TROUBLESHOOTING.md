# 트러블슈팅

앱 코드로는 고칠 수 없거나, 증상만 보고 앱 버그로 오인하기 쉬운 항목을 남긴다.

## iOS dev 빌드에서 Expo 개발용 플로팅 버블(FAB)이 안 보임

**증상** — 앱을 강제 종료한 뒤 다시 실행하면 우하단 Expo 개발 메뉴 버블이 간헐적으로 나타나지 않는다. 그 자리를 눌러도 반응이 없다. 앱 자체 UI(녹음 플로팅 버튼 등)는 정상이다.

**원인** — `expo-dev-menu`의 `ios/DevMenuManager.swift` `updateFABVisibility()`는 FAB window를 만들 때 `.foregroundActive` 상태인 `UIWindowScene`을 요구한다. 콜드 스타트에서 RN 콘텐츠 등장이 scene 활성화보다 빠르면 window를 만들지 않고 종료하며, 이후 `fabWindow?.setVisible(...)`은 nil이라 무시된다. 재시도 경로가 없다 — 호출자는 `setAppContext`와 `RCTContentDidAppear` 옵저버뿐이고 후자는 1회 발화 후 스스로 제거된다.

**범위** — 라이브러리 버그이며 dev 빌드에만 존재한다. 릴리스 빌드에는 FAB 자체가 없다. expo-dev-menu 57.0.18(최신 stable)과 58.0.0 canary 모두 같은 로직이라 버전을 올려도 해결되지 않는다.

**대응** — 앱 코드에 개발용 우회를 넣지 않는다. FAB이 없으면 기기를 흔들어(shake) dev menu를 연다. 세 손가락 길게 누르기도 같은 메뉴를 연다.
