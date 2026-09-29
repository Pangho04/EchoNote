# ViewModel과 표현 데이터 흐름

`apps/mobile`의 Meeting·Recording·목록·SQLite·ViewModel 작업에 적용한다.

- 외부 데이터는 `네트워크 DTO 또는 영속 row → adapter mapper → Domain → 함수형 ViewModel → View` 순서로 변환한다. View가 DTO나 row를 직접 받지 않는다.
- 네트워크 DTO와 Domain mapper는 관련 entity·feature의 `api` segment adapter가, 영속 row와 Domain mapper는 repository adapter가 소유한다. `model`과 `ui` segment가 DTO나 row 타입에 의존하지 않는다.
- 함수형 ViewModel을 기본으로 사용한다. 관련 slice의 `model` segment에 화면 표시 타입과 `to...ViewModel` 순수 mapper를 두며 React 상태, repository 호출, 파일·네트워크 부작용을 넣지 않는다.
- page composition 또는 page의 ViewModel hook은 받은 Domain을 함수형 ViewModel로 변환해 widget·entity UI에 props로 전달한다. `MeetingList` 같은 UI 컴포넌트가 repository, API, Domain sample을 직접 import해 데이터 원본을 소유하지 않는다.
- 로딩·오류·선택·생성 중 상태나 화면 명령 조율이 필요할 때만 `use...ViewModel` hook을 해당 page·widget·feature의 `model` segment에 둔다.
- ViewModel hook은 View가 소비할 상태와 callback을 제공하고 feature의 공개 기능 함수에 위임한다. 비즈니스 규칙, SQL·HTTP, 파일 처리, 녹음기·플레이어 수명주기를 직접 구현하지 않는다.
- Feature는 사용자 행동과 그 처리 규칙을, entity Domain은 앱의 불변식과 의미를, adapter와 플랫폼 서비스는 저장·네트워크·기기 세부사항을 소유한다.
- `MeetingStatus`는 `entities/meeting/model/meeting.ts`의 string `enum` 하나로 정의한다. Domain·ViewModel은 enum member를 사용하고, SQLite Row와 서버 DTO의 raw string은 adapter 경계에서 검증해 enum으로 변환한다.
- `MeetingStatus.LocalOnly`는 모바일이 소유한다. 그 외 처리 상태는 Gateway 작업 상태를 반영하며 모바일이 임의로 전이시키지 않는다.
- SQLite outbox의 전송 상태는 `MeetingStatus`와 별도 타입으로 관리한다. `pending`, `sending`, `failed` 같은 outbox 상태를 회의 처리 상태에 추가하지 않는다.
- `Meeting 1 : 1 Recording`을 영구 원칙으로 한다. `Recording`은 별도 녹음 ID나 녹음 세션 식별자를 만들지 않고 `meetingId`를 유일한 identity로 재사용한다. SQLite `recordings.meeting_id`는 `PRIMARY KEY`이자 `meetings(id)`를 참조하는 FK다. 이 shared PK/FK만으로 parent의 필수 child 존재까지 보장되지는 않으므로 Meeting·Recording을 같은 transaction에서 생성·삭제하고 orphan 검증을 둔다. `jobId`, command ID, upload attempt ID는 같은 Recording을 여러 번 처리할 수 있게 구분하는 처리 시도 식별자이며 Recording 식별자로 합치지 않는다. `Meeting` Domain은 화면 조합을 단순하게 하기 위해 nullable `durationMs`를 가질 수 있지만, SQLite에서는 saved RecordingRow가 원본이며 `meetings` row에 복제하지 않는다.
- 학습 단계에서는 실제 경계를 도입할 때 타입을 만든다. SQLite Row는 schema 단계, ResponseDTO는 서버 API 단계에서 정의하며 사용되지 않는 경계 타입을 미리 만들지 않는다.
- SQLite `meetings` row는 `id`, 정규화한 `title`, `created_at_ms`, `updated_at_ms`만 소유한다. status는 InferenceJobRow 부재 시 `LocalOnly`, 존재 시 검증한 서버 status로 만든다.
- SQLite timestamp는 UTC epoch millisecond `INTEGER`, Domain timestamp는 ISO 8601 string을 사용한다. Row mapper만 둘을 변환한다.
- `createdAt`은 Meeting이 EchoNote에 등록된 시각이며 생성 뒤 바꾸지 않는다. 회의 목록 날짜·정렬·연도 조회·cursor·기본 제목 기준은 `createdAt`이다. `updatedAt`은 마지막 수정 시각이므로 목록 정렬이나 duration 계산에 사용하지 않는다.
- 외부에서 과거 녹음을 가져와도 가져와 등록한 시각을 Meeting의 `createdAt`으로 사용한다. 실제 녹음 시각은 MVP Meeting 관리 기준이 아니며 요구가 생기기 전 `Recording.recordedAt` 같은 미래 필드를 추가하지 않는다.
- 빈 Meeting 제목은 생성 당시 기기 IANA time zone의 `createdAt`을 `yyyy-MM-dd 오전/오후 hh:mm:ss_녹음` 형식으로 한 번 만들며, 이후 time zone 변경으로 자동 수정하지 않는다.
- 목록 기능은 선택 연도와 기기 현재 IANA time zone을 `[연도 시작, 다음 연도 시작)` UTC epoch millisecond 범위로 바꿔 `ListMeetingsQuery`로 repository에 전달한다. repository는 year나 time zone을 해석하지 않고 SQLite에서 `createdAt DESC, id DESC`로 조회하며, 전체 Row를 읽은 뒤 ViewModel에서 연도를 거르지 않는다.
- 목록 query의 `cursor`는 그 cursor가 가리키는 Meeting부터 결과에 포함한다. repository는 `limit + 1`건을 읽고, 반환하지 않은 lookahead Meeting이 있으면 그 Meeting을 `nextCursor`로 제공하며 없으면 `null`을 제공한다.
- 1B 검색은 이미 불러온 page를 ViewModel에서 거르지 않는다. 기존 SQLite 목록 query에 정규화한 title filter를 추가하고 `연도·filter → inclusive cursor → createdAt DESC, id DESC → limit + 1` 순서로 조회한다. `%`, `_`, escape 문자는 literal로 처리하며 검색어 변경 시 items·cursor를 초기화한다.
- 생성·제목 변경·삭제는 SQLite commit 성공 뒤 현재 목록 조건으로 실제 DB를 재조회한다. 화면에만 optimistic 성공 행을 확정하지 않는다.
- Stage 1의 `meetings` 단독 schema는 목록·SQLite를 배우기 위한 임시 scaffold일 뿐 제품 영속 계약이 아니다. Stage 2부터 Meeting·Recording을 `meetingId` 하나로 같은 transaction에서 생성·삭제하고, `recordings.meeting_id PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE`와 orphan 0건 검증을 적용한다. 검증용 recording table이나 fake repository를 만들지 않는다.
- 목록 날짜 label과 연도 조회는 같은 기기 현재 time zone을 사용한다. time zone이나 선택 연도가 바뀌면 기존 items와 cursor를 버리고 첫 page부터 다시 조회한다.
- `MeetingListItemVM`은 월·일과 표시 label만 가지며 `yearLabel`을 두지 않는다. 선택 연도와 연도 변경 command는 page-level ViewModel hook이 소유하고 목록 상단 control이 한 번 표시한다.
- 목록 `metaLabel`은 duration과 상세 상태 설명을 조합한다. chip은 `MeetingStatus`만 복사하지 않고 `pendingReviewCount`와 최신 outbox command를 함께 사용하며, local-only 항목처럼 chip이 필요 없으면 disclosure accessory를 사용한다. outbox 표시는 UI 우선순위일 뿐 `MeetingStatus` 전이가 아니다.
- ViewModel 필드 추가만으로 UI 변경이 승인된 것은 아니다. 새 표시 요소는 위치·타이포그래피·간격·접근성 사양이 목업에 추가된 뒤 View에서 렌더링한다.
