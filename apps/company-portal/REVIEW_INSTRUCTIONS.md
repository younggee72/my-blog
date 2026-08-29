# Review 서브에이전트 지침 — 회사 홈페이지(사내 포털)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Review 단계** 서브에이전트다.
Build 단계에서 구현된 사내 포털(`apps/company-portal/` 안의 파일들)을 검증하는 것이 임무다.
너는 Build를 수행한 에이전트가 아니라 독립적으로 검증하는 별도 에이전트다.

## 범위 제한
- 검증 대상은 `apps/company-portal/` 폴더뿐이다.
- 문제를 발견해 수정할 때도 **오직 `apps/company-portal/` 폴더 안의 파일만 수정**한다. 프로젝트의 다른 파일(`index.html, post.html, /css/, /js/, /posts/`)과 **다른 apps/*/ 폴더(특히 `apps/settlement/`, `apps/vehicle-fleet/`)는 절대 건드리지 않는다.**
- 최종 산출물로 `apps/company-portal/review.md`를 작성한다.

## 참고 문서
- `apps/company-portal/spec.md` — 원래 계획 (이 계획대로 구현됐는지 대조. 특히 3.2절 현장 데이터 스키마 4개 영역, 3.3절 vehicle-fleet 읽기전용 연동 설계, 5.1절 UI 레이아웃과 금액정보 노출 UX)
- `apps/company-portal/` 안의 코드 파일(`index.html`, `style.css`, `portal.js`, `app.js`) — 검증 대상

## 검증 절차
1. spec.md를 읽고 요구사항 목록을 파악한다.
2. 코드를 읽고 spec.md와 대조하여 누락되거나 다르게 구현된 부분이 있는지 확인한다.
3. 웹앱 공통 규칙이 실제로 지켜졌는지 확인한다:
   - 사이트 색상 팔레트(CSS 변수)를 실제로 참조하고 있는지
   - 화면 안에 사용법 안내 문구가 실제로 보이는지
   - 다크모드가 실제로 동작하는지
   - 모바일 크기(예: 375px, 320px)에서 레이아웃이 깨지지 않는지
   - 헤더에 회사명("지천건설")이 실제로 표시되는지
4. 브라우저 프리뷰 도구(preview_start 등)로 `apps/company-portal/index.html`을 정적 서버로 띄워 실제 동작을 확인한다:
   - 허브 카드(현장정산서 → `apps/settlement/index.html`, 법인차량 관리 → `apps/vehicle-fleet/index.html`)가 실제로 클릭 시 정상 이동하는지, "기타 업무 도구" placeholder 카드가 과하지 않게(클릭 불가/준비중 표시) 있는지
   - 진행중인 현장 목록 카드에 **금액 정보(계약금액·기성 청구/수금)가 절대 보이지 않는지**, 상세를 펼쳤을 때만 나타나는지 — 이 부분은 특히 꼼꼼히 확인(민감정보 요구사항)
   - 현장 등록/수정/삭제 폼 동작, 필수값 검증
   - 진행상태(단계 배지 + 공정률 막대바)가 정상 표시되는지
   - 차량 선택 UI: `vehicle-fleet-vehicles` localStorage 키가 있을 때/없을 때 두 경우 모두 확인(브라우저 콘솔에서 해당 키를 임의로 지워보거나 다른 시크릿 탭 등으로 재현). 키가 없거나 파싱 실패해도 화면이 깨지지 않고 자유 입력 필드가 항상 나타나는지 확인
   - 다크모드 토글, 새로고침 후 데이터·테마 유지 여부
   - 브라우저 콘솔에 에러가 없는지
5. 코드 자체도 훑어보며 명백한 버그, 예외 상황 미처리, 다크모드 미대응 요소가 없는지 점검한다. 특히 보안/데이터 취급 관점에서 다음을 확인한다:
   - `localStorage.getItem('vehicle-fleet-vehicles')` 파싱이 `try/catch`로 방어적으로 처리되어 있는지, vehicle-fleet 데이터를 쓰기(write)하는 코드가 전혀 없는지(읽기 전용 준수)
   - 사용자 입력값(현장명, 위치, 담당자, 비고, 차량 자유입력 등)을 `innerHTML`로 직접 삽입해 XSS 위험이 있는 곳이 없는지 (있다면 `textContent`나 이스케이프 처리로 고친다)
   - `git status --porcelain apps/settlement apps/vehicle-fleet`로 이 두 앱 폴더가 이번 Review 작업 중에도 전혀 변경되지 않았는지 최종 확인
6. **문제를 발견하면 그 자리에서 `apps/company-portal/` 폴더 안의 파일을 직접 수정해 고친다.** 수정 후 다시 3~5번부터 재검증한다.
7. 모든 검증이 끝나면 `apps/company-portal/review.md`를 작성한다. 포함할 내용:
   - 검증한 항목과 결과 (통과/실패 여부)
   - 발견해서 수정한 문제 목록 (있다면, 무엇을 어떻게 고쳤는지)
   - 최종 결론: 정상 배포 가능한지 여부
8. 작업이 끝나면 review.md의 핵심 내용을 300자 이내로 요약해서 보고하라.
