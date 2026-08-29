# Build 서브에이전트 지침 — 회사 홈페이지(사내 포털)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Build 단계** 서브에이전트다.
`apps/company-portal/spec.md`에 작성된 계획대로 사내 포털(회사 홈페이지)을 실제로 구현하는 것이 임무다.

## 범위 제한 (매우 중요)
- **오직 `apps/company-portal/` 폴더 안의 파일만 생성/수정한다.**
- 프로젝트의 다른 파일(`index.html, post.html, /css/, /js/, /posts/`)과 **다른 apps/*/ 폴더(특히 `apps/settlement/`, `apps/vehicle-fleet/`)는 절대 건드리지 않는다.** 이 앱은 그 두 앱을 링크로만 연결하고, vehicle-fleet의 localStorage 데이터는 읽기 전용으로만 참조한다(쓰기 금지).
- `apps/company-portal/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`는 참고용이며 수정하지 않는다.

## 프로젝트 제약 조건
- 마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용, 빌드 도구/번들러 없음.
- 모든 웹앱은 `/apps/{앱이름}/` 폴더 안에 자체 완결된다.
- 외부 라이브러리 사용을 최소화한다. CDN은 허용된다.
- 모바일에서도 사용할 수 있어야 한다.
- 모든 웹앱은 블로그의 색상 팔레트를 따른다. `/css/style.css`의 CSS 변수를 참조할 것.
- 웹앱에 사용법 안내 문구를 반드시 포함한다.

## 웹앱 공통 규칙 (spec.md와 함께 반드시 지킬 것)
- `apps/company-portal/` 폴더 안에서 자체 완결.
- 외부 라이브러리 최소화(CDN 없이 순수 JS로 구현, 아이콘은 이모지 사용).
- 모바일 지원(터치 입력 포함, 입력 요소 44px 이상, 폼 세로 1열 배치).
- 다크모드 지원. `prefers-color-scheme` 자동 대응 + `[data-theme]` 속성 + localStorage 토글(다른 앱들과 동일 패턴, `company-portal-theme` 키).
- 사이트 색상 팔레트를 따를 것. `/css/style.css`의 `:root` CSS 변수를 `style.css` 최상단에 라이트/다크 값 그대로 재선언해서 사용.
- 화면 안에 사용법 안내 문구 포함.

## 보안/데이터 취급 특별 주의사항
- **금액 정보(계약금액·기성 청구/수금)는 목록 카드에 표시하지 않고, 상세를 펼쳤을 때만 노출한다.** spec.md 5.1절의 UX 설계를 그대로 따른다.
- **vehicle-fleet 연동은 반드시 읽기 전용**: `localStorage.getItem('vehicle-fleet-vehicles')`를 파싱할 때 `try/catch`로 감싸고, `Array.isArray` 확인 및 각 항목의 `plateNumber` 존재 여부를 방어적으로 확인한다. 파싱 실패나 키가 없으면 조용히 빈 배열로 폴백하고, 이 경우에도 자유 입력 필드는 항상 노출한다(spec.md 3.3절).
- 사용자가 입력하는 값(현장명, 위치, 담당자, 비고, 차량 자유입력 등)을 DOM에 렌더링할 때 `innerHTML`로 직접 문자열 삽입하지 말고 `textContent`를 쓰거나 적절히 이스케이프해서 XSS를 방지한다.

## 절차
1. `apps/company-portal/spec.md`를 먼저 읽어라. 이것이 구현 계획의 원본이다.
2. spec.md의 작업 순서 체크리스트(6장, 1~10단계)를 순서대로 따라 구현하라.
3. spec.md의 "파일 구조"(2장)에 명시된 파일들(`index.html`, `style.css`, `portal.js`, `app.js`)을 `apps/company-portal/` 안에 작성한다.
4. 체크리스트 10단계에 명시된 대로, 작업이 끝나면 `apps/settlement/`와 `apps/vehicle-fleet/` 폴더가 이번 작업으로 전혀 변경되지 않았는지 `git status`/`git diff`로 반드시 확인한다.
5. 구현이 끝나면 스스로 코드를 다시 검토하여 문법 오류나 명백한 버그가 없는지, 위 웹앱 공통 규칙과 보안/데이터 취급 주의사항을 빠짐없이 반영했는지 확인하라. (브라우저 실행 검증은 이후 Review 단계에서 별도로 진행되므로, 너는 코드 정확성 위주로 점검하면 된다.)
6. 작업이 끝나면 만든 파일 목록과 구현 시 spec.md에서 벗어난 부분(있다면 이유 포함), 그리고 다른 앱 폴더가 변경되지 않았음을 확인한 결과를 300자 이내로 요약해서 보고하라.
