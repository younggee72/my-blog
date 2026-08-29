# company-portal — Review 결과

Build 단계와 독립된 Review 서브에이전트로서 `apps/company-portal/`을 spec.md와 대조하고, 정적 서버(`python -m http.server 8000`)로 실제 브라우저에서 검증했다.

## 1. spec.md 대조 결과

| 항목 | 결과 |
|---|---|
| 3.1 localStorage 키 접두사(`company-portal-*`) 충돌 없음 | 통과 |
| 3.2 현장 데이터 스키마 4개 영역(기본정보/진행상태/금액/투입 차량) 모두 구현 | 통과 |
| 3.3 vehicle-fleet 읽기 전용 연동(try/catch, 필드 방어, 빈 배열 폴백, 자유 입력 병행) | 통과 |
| 3.4 초기 샘플 데이터 2건(포터 plateNumber 자동 매칭 포함) | 통과 — 실제 vehicle-fleet 시드(12가 1001, 1002 등)와 매칭 확인 |
| 5.1 UI 레이아웃(헤더/허브 3카드/현장 섹션/사용법 안내) | 통과 |
| 5.1 금액 정보 미노출(목록) → 상세에서만 노출 | 통과 — 코드·화면 모두 확인 |
| 5.2 CSS 변수 재선언값이 `/css/style.css`와 동일 | 통과 — 값 일치 확인(diff 없음) |

## 2. 공통 규칙 점검

- 색상 팔레트: `style.css`의 `--color-*` 값이 `/css/style.css`와 정확히 일치.
- 사용법 안내 문구: 상단 접이식 박스에 4개 항목(로컬 저장 전용, 금액은 상세에서만, 차량은 법인차량 관리에서 선택/직접입력, 허브 이동) 모두 실제 렌더링 확인.
- 다크모드: 토글 클릭 시 즉시 반영, 새로고침 후 유지(`company-portal-theme`), 폼/모달/배지/진행률 막대 모두 다크 팔레트로 정상 전환.
- 모바일: 375px, 320px 뷰포트에서 허브/현장 카드 그리드가 1열로 전환되고 가로 스크롤 없음. 폼 입력 요소 `min-height: 44px` 확보.
- 헤더 회사명 "지천건설" 표시 확인(`<h1>🏢 지천건설 사내 포털</h1>`, `<title>`도 동일).

## 3. 브라우저 실동작 검증

- 허브 카드 클릭 → `apps/settlement/index.html`, `apps/vehicle-fleet/index.html`로 실제 이동 확인(각각 새로 페이지 로드, `location.href` 확인). "기타 업무 도구" 카드는 `<div aria-disabled>`로 클릭 불가, 점선 테두리 + "추후 추가 예정입니다" 안내로 과하지 않게 구현.
- 진행중인 현장 카드: 계약금액/기성 청구·수금액이 카드에 전혀 렌더링되지 않음(DOM에도 없음). 카드 클릭 시에만 상세 모달에서 "금액 정보" 박스(`--color-bg-secondary` 배경)로 노출.
- 등록 폼: 필수값(현장명/위치/착공일/담당자) 비운 채 제출 시 4개 필드 모두 인라인 에러 표시, 제출 차단 확인. 정상값 입력 후 저장 시 목록에 즉시 반영, 새로고침 후에도 유지.
- 진행상태: 단계 select 변경 시 공정률 숫자/슬라이더가 힌트값으로 프리필되고, 사용자가 직접 덮어쓸 수 있음. 배지 + 진행률 막대바 목록/상세 모두 정상 표시.
- 삭제: `confirm()` 다이얼로그 게이트가 실제로 삭제를 막는 것을 확인(다이얼로그 미승인 시 데이터 그대로 유지).
- 차량 선택 UI:
  - `vehicle-fleet-vehicles`가 있는 브라우저: 실제 등록된 9개 차량(포터 6, 덤프 1, 포크레인 1, 승용차 1)이 체크박스로 정상 렌더링, 상세에서 매칭된 plateNumber에 `(vehicleType)` 라벨까지 표시.
  - 없는 경우(비파괴적으로 `Storage.prototype.getItem`을 임시 몽키패치해 재현): 체크리스트는 비고 안내 문구("등록된 차량이 없습니다…")를 보여주고 자유 입력 필드는 항상 노출 — 레이아웃 깨짐 없음.
  - `getVehicleFleetVehiclesReadOnly()`를 `null`/손상된 JSON/비배열/`plateNumber` 누락 항목 등 4가지 케이스로 직접 호출해 항상 안전한 폴백(`[]` 또는 유효 항목만 필터링)을 반환함을 확인.
- 콘솔 에러: company-portal만 단독으로 로드한 새 탭에서는 에러 0건. (참고: vehicle-fleet 앱을 먼저 방문했던 탭에서 `net::ERR_NAME_NOT_RESOLVED` 및 "웹훅 전송 실패" 경고가 있었으나, 스택트레이스 확인 결과 `apps/vehicle-fleet/app.js`의 자체 웹훅 알림 기능에서 발생한 것으로 company-portal과는 무관함.)
- XSS 점검: 현장명에 `<img src=x onerror=alert(1)>` 페이로드를 입력해 등록 → 목록/상세 어디서도 스크립트가 실행되지 않고 문자 그대로 표시됨을 확인(`escapeHtml` 정상 동작). `innerHTML`을 사용하는 모든 렌더링 지점(현장 카드 목록, 상세 투입차량 태그, 차량 체크리스트)에서 사용자 입력 필드는 예외 없이 `escapeHtml()`을 거침을 코드로도 재확인.

## 4. 코드 정적 점검(보안/데이터 취급)

- `localStorage.getItem('vehicle-fleet-vehicles')` 파싱: `try/catch` + `Array.isArray` + 항목별 `plateNumber` 타입 체크로 방어적으로 구현됨(`portal.js`).
- vehicle-fleet 키에 대한 `setItem` 호출은 코드 전체에서 0건(`grep` 확인) — 읽기 전용 원칙 준수.
- `git status --porcelain apps/settlement apps/vehicle-fleet` 결과, Review 작업 전후로 두 폴더에 변경 없음(기존에 있던 미추적 `apps/settlement/_review_tmp/`만 그대로 존재, 이번 작업으로 생성/수정된 파일 아님).

## 5. 발견 후 수정한 문제

없음. 위 항목 전부 1차 구현 상태에서 통과했으며, `apps/company-portal/` 내 파일을 수정하지 않았다.

## 6. 최종 결론

**정상 배포 가능.** spec.md의 요구사항(허브 연동, 현장 CRUD, 금액 정보 노출 제어, vehicle-fleet 읽기 전용 연동과 폴백, 다크모드, 반응형, 사용법 안내)이 모두 코드와 실제 브라우저 동작에서 확인되었고, XSS·타 앱 데이터 오염 등 보안/격리 리스크도 발견되지 않았다.
