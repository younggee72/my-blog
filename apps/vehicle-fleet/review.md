# Review — 법인차량 관리 프로그램

검증자: Review 서브에이전트 (Build와 독립). 대상: `apps/vehicle-fleet/` (index.html, style.css, fleet.js, app.js), 대조 문서: `spec.md`.

## 1. spec.md 대조 결과

- 파일 구조(2절): index.html/style.css/fleet.js/app.js 분리 — 계획대로 구현됨.
- 차종 상수(3.1), 데이터 스키마(3.2): `VEHICLE_TYPES`, `CONSUMABLE_TYPES` 필드 구성이 spec과 동일. Vehicle/ScheduleItem/ConsumableItem 스키마 필드 일치.
- 최신 1건 유지 방식(3.3): "교환 완료 처리"가 새 레코드를 만들지 않고 기존 항목을 갱신 — 확인.
- 계산 로직(3.4): `getNextDueDate`/`getKmRemaining`/`getItemStatus`/`getFleetSummary` 구현이 spec 의사코드와 동일 로직. 브라우저에서 실제 날짜(오늘 2026-08-29) 기준 경과/임박/정상 배지가 정확히 계산됨을 확인(예: 포터3 검사 2026-09-05 만기 → 임박, 보험 2026-08-01 만기 → 경과).
- localStorage(3.5), 시드데이터(3.6): 키 3종 + 초기화 플래그 확인, 9대 시드 데이터가 상태 골고루 분포.
- 내보내기/가져오기(3.7): JSON 다운로드 구조 확인, 가져오기 시 스키마 검증·병합/교체 확인창·형식 오류 알림 모두 정상 동작(아래 2절 실측).
- **알림(웹훅) 설계(3.8) 및 알림 설정 UI(4.5)**: `loadNotifyConfig/saveNotifyConfig`, `loadNotifyLog/saveNotifyLog`, `getNotifyTargets`, `buildNotifyPayload`, `sendWebhookNotification`(no-cors, catch 처리) 모두 spec 그대로 구현됨. 앱 로드 시 자동 체크 → enabled/URL 없으면 스킵 → 대상 있으면 1회 호출 → 발송 로그 기록 흐름 확인. 알림 설정 모달(URL 입력, 켜기/끄기, 테스트 전송, 저장, 안내문구) 구성도 4.5절과 일치.

## 2. 실제 브라우저 동작 검증 (정적 서버 구동, localhost:8000/apps/vehicle-fleet/)

모두 통과:
- 대시보드 요약 배지(9대/임박·경과 건수)가 실제 데이터 기준으로 정확히 계산되어 표시됨.
- 차량 카드 클릭 → 상세화면 진입, "← 대시보드로" 복귀 정상.
- 차량 등록(자동 소모품 추가 체크 시 차종별 defaultConsumables 정확히 생성 확인) / 수정 / 삭제(cascade로 연결된 schedules·consumables까지 함께 삭제됨을 localStorage 직접 확인) 모두 정상.
- 검사/보험 항목의 상태 배지, 소모품 "교환 완료 처리" 인라인 갱신(날짜·주행거리 갱신 후 상태 배지가 경과→정상으로 즉시 재계산) 정상.
- 내보내기 다운로드 로직 확인, 가져오기: 잘못된 JSON은 에러 알림 후 무시, 올바른 백업 파일은 병합 모드로 정상 반영됨을 확인.
- **알림 설정 모달**: 유효하지 않은 도메인으로 "테스트 전송" 클릭 시 `fetch` 실패가 catch되어 "전송 요청 자체가 실패했습니다" 안내만 표시되고 앱은 정상 동작(콘솔 warning만 남고 throw 없음). URL 비운 채 "알림 켜기" 체크 후 저장 시 `enabled`가 자동으로 `false`로 보정되어 저장됨을 localStorage로 확인.
- **자동 알림 체크**: `enabled:false`(기본값) 상태에서 앱 로드 시 웹훅 관련 네트워크 요청이 전혀 발생하지 않음(네트워크 로그로 확인). `enabled:true` + 잘못된 URL로 설정 후 재로드하면 1회 전송 시도(실패해도 무시)와 함께 `notify-log`에 오늘 날짜로 기록되고, 같은 날 재로드 시에는 추가 네트워크 요청이 발생하지 않음(중복 발송 방지, `performance.getEntriesByType('resource')`로 확인)을 확인.
- 다크모드 토글 정상 동작, 상태 배지 대비 양호. 새로고침 후 데이터·테마 모두 유지됨.
- 모바일 폭(375px)에서 대시보드/상세화면/폼 레이아웃이 1열로 정상 전환, 버튼 44px 이상 터치 영역 확보, 가로 스크롤 없음.
- 콘솔 에러: 없음(의도적으로 발생시킨 웹훅 실패 관련 warning/네트워크 에러 제외).
- 보안 점검: 웹훅 URL/키가 코드에 하드코딩된 곳 없음(전부 `loadNotifyConfig`로 localStorage에서만 읽음). `innerHTML`로 사용자 입력을 삽입하는 모든 곳(`escapeHtml` 사용)을 확인했고, `<img src=x onerror=...>` / `<script>` 문자열을 차량번호·비고에 직접 입력해 등록해도 스크립트가 실행되지 않고 텍스트로만 표시됨을 실제로 검증(XSS 없음).

## 3. 발견하여 수정한 문제

### 버그: 조건부 입력 필드의 `hidden` 토글이 화면에 반영되지 않음

**증상**: 브라우저에서 실제로 조작해보니 다음 3곳에서 JS의 `element.hidden = true/false` 토글이 시각적으로 전혀 반영되지 않는 것을 발견했다(요소가 항상 보이는 상태로 렌더링됨).
1. 검사/보험 항목 폼의 "다음 예정일 직접 입력" 토글 — 체크 여부와 무관하게 "주기(개월)"과 "다음 예정일" 입력란이 동시에 표시됨(spec 4.2, 4.5 의도와 다름).
2. 소모품 항목 폼의 종류를 "기타 소모품"으로 바꾸지 않아도 "항목명" 입력란이 항상 노출됨(spec 4.3 의도와 다름).
3. 차량 정보 "수정" 시에도 "기본 소모품 자동 추가" 체크박스 필드가 계속 노출됨(spec 4.1 — 수정 시에는 숨겨야 함).

**원인**: `style.css`에 `.form-field { display: flex; ... }` 규칙이 있는데, 브라우저 기본 스타일 `[hidden] { display: none }`은 User-Agent(브라우저 기본) origin이고 `.form-field`는 Author(개발자 작성) origin이라, CSS 캐스케이드 우선순위상 **origin이 같은 specificity·순서보다 우선**하므로 author 규칙이 항상 이긴다. 즉 `.form-field` 클래스가 있는 요소는 `hidden` 속성을 줘도 `display:flex`가 유지되어 실제로는 숨겨지지 않았다. (`.form-panel`, `.error-msg`, `.form-toast`, `.inline-form`, `.modal-overlay`, `.guide-content`, `.screen` 등은 각각 `[hidden] { display: none; }` 전용 규칙이 이미 있어 문제 없었음 — `.form-field`와 그 하위 `.form-checkbox`만 누락되어 있었다.)

**수정**: `apps/vehicle-fleet/style.css`에 전역 규칙을 추가해, 어떤 클래스가 붙어 있든 `hidden` 속성이 항상 화면에서도 숨겨지도록 보장했다.

```css
[hidden] {
  display: none !important;
}
```

**재검증**: 수정 후 브라우저에서 세 케이스 모두 재확인(콘솔에서 `getComputedStyle(el).display` 직접 측정 및 스크린샷)했고, "다음 예정일 직접 입력" 토글이 두 필드를 정확히 교대로 표시/숨김, "기타" 선택 시에만 항목명 필드 노출, 차량 수정 모드에서 기본 소모품 체크박스 필드가 숨김 처리되는 것을 모두 확인했다.

이 수정은 `apps/vehicle-fleet/style.css` 한 곳(전역 `[hidden]` 규칙 추가)에만 있으며, 프로젝트의 다른 파일은 건드리지 않았다.

## 4. 결론

spec.md의 요구사항(핵심 로직, 알림/웹훅 설계 3.8절 포함)이 코드에 충실히 반영되어 있고, 위에서 발견한 `hidden` CSS 버그를 수정 후 재검증까지 마쳤다. 사이트 팔레트 CSS 변수 사용, 사용법 안내 문구, 다크모드, 반응형(375px), XSS 방어, 웹훅 URL 비하드코딩 등 공통 웹앱 규칙도 모두 충족한다. **정상 배포 가능**하다고 판단한다.
