# Build 서브에이전트 지침 — 업무자료실(Firebase Storage 연동)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Build 단계** 서브에이전트다.
`apps/company-portal/spec.md` 8장("업무자료실")에 따라 업무자료실 기능을 실제로 구현하는 것이 임무다. 1~7장 관련 기존 기능(허브 카드 링크 2개, 진행중인 현장 CRUD, 공개 랜딩, 비밀번호 잠금 등)은 그대로 유지하고, 8장 내용만 추가 구현한다.

## 범위 제한 (매우 중요)
- **오직 `apps/company-portal/` 폴더 안의 파일만 생성/수정한다.**
- 프로젝트의 다른 파일(`index.html`, `post.html`, `/css/`, `/js/`, `/posts/`)과 **다른 apps/*/ 폴더(특히 `apps/settlement/`, `apps/vehicle-fleet/`)는 절대 건드리지 않는다.**
- `apps/company-portal/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`, `review.md`는 참고용이며 수정하지 않는다(spec.md는 이미 8장까지 작성되어 있으니 읽기만 한다).

## 절차
1. `apps/company-portal/spec.md`의 **8장 전체**를 먼저 정독해라. 이것이 이번 기능의 구현 명세다(8.3절 Firebase 초기화/업로드/목록/삭제 의사코드, 8.4절 보안 현황 고지 문구, 8.5절 UI 레이아웃, 8.6절 안내 문구를 그대로 따른다).
2. 기존 `index.html`을 읽어 "업무 도구" 허브 카드 3장 마크업 구조(특히 현재 비활성 상태인 "기타 업무 도구" 카드와, 활성 상태인 "현장정산서"/"법인차량 관리" 카드의 마크업 차이)를 파악한다.
3. spec.md 8.7절의 작업 순서 체크리스트(18~27번)를 순서대로 따라 구현한다.
4. spec.md 8.2절 "파일 구조"에 명시된 새 파일(`materials.html`, `materials.css`, `materials.js`)을 만들고, `index.html`은 허브 카드 하나만 수정한다.
5. **Firebase 설정값은 spec.md 8.3절에 있는 그대로 정확히 사용한다.** (이 값은 클라이언트 공개 설정 정보이며 비밀번호/API 시크릿이 아니므로, 다른 앱들에서 지켰던 "비밀정보 하드코딩 금지" 규칙과는 무관하다 — 그대로 코드에 넣어도 된다.)
6. **Firebase JS SDK는 spec.md에 명시된 CDN(ES 모듈, `https://www.gstatic.com/firebasejs/10.12.2/...`)로 불러온다.** `materials.js`는 `<script type="module">`로 로드해야 한다.
7. 사용자가 입력/업로드하는 파일명 등을 DOM에 렌더링할 때 `innerHTML`로 직접 문자열 삽입하지 말고 `textContent`를 쓰거나 이스케이프 처리해서 XSS를 방지한다(파일명에 특수문자가 들어갈 수 있음).
8. 구현 중 실제로 브라우저에서 동작을 확인해야 하는 단계(체크리스트 21~25번)는 반드시 정적 서버로 띄워서(`file://` 직접 열기 금지 — ES 모듈은 file://에서 CORS 에러가 날 수 있음) 실제 Firebase 프로젝트(`jicheon-construction`)에 연결해 테스트한다. 테스트용으로 업로드한 파일은 정리하지 않아도 된다(사용자가 나중에 정리 가능).
9. 체크리스트 27번에 명시된 대로, 작업이 끝나면 `apps/settlement/`와 `apps/vehicle-fleet/` 폴더가 이번 작업으로 전혀 변경되지 않았는지 `git status`/`git diff`로 반드시 확인한다.
10. 작업이 끝나면 만든/수정한 파일 목록, spec.md에서 벗어난 부분(있다면 이유 포함), 실제 업로드/다운로드/삭제 테스트 결과, 다른 앱 폴더 무변경 확인 결과를 300자 이내로 요약해서 보고하라.
