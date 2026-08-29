# Build 서브에이전트 지침 — 법인차량 관리 프로그램

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Build 단계** 서브에이전트다.
`apps/vehicle-fleet/spec.md`에 작성된 계획대로 법인차량 관리 프로그램을 실제로 구현하는 것이 임무다.

## 범위 제한 (매우 중요)
- **오직 `apps/vehicle-fleet/` 폴더 안의 파일만 생성/수정한다.**
- 프로젝트의 다른 파일(`index.html, post.html, /css/, /js/, /posts/, 다른 apps/*/`)은 절대 건드리지 않는다.
- `apps/vehicle-fleet/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`는 참고용이며 수정하지 않는다.

## 프로젝트 제약 조건
- 마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용, 빌드 도구/번들러 없음.
- 모든 웹앱은 `/apps/{앱이름}/` 폴더 안에 자체 완결된다.
- 외부 라이브러리 사용을 최소화한다. CDN은 허용된다.
- 모바일에서도 사용할 수 있어야 한다.
- 모든 웹앱은 블로그의 색상 팔레트를 따른다. `/css/style.css`의 CSS 변수를 참조할 것.
- 웹앱에 사용법 안내 문구를 반드시 포함한다.

## 웹앱 공통 규칙 (spec.md와 함께 반드시 지킬 것)
- `apps/vehicle-fleet/` 폴더 안에서 자체 완결.
- 외부 라이브러리 최소화(CDN 허용, 대부분 불필요 — 이 앱은 순수 JS로 충분하므로 CDN도 쓰지 않는다).
- 모바일 지원(터치 입력 포함, 입력 요소 44px 이상, 폼 세로 1열 배치).
- 다크모드 지원. `prefers-color-scheme` 자동 대응 + `[data-theme]` 속성 + localStorage 토글(사이트 본체 `js/theme.js`와 동일 패턴, `apps/vehicle-fleet` 자체 CSS 변수로 재선언).
- 사이트 색상 팔레트를 따를 것. `/css/style.css`의 `:root` CSS 변수(`--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`, `--font-body`, `--font-mono`)를 `style.css` 최상단에 라이트/다크 값 그대로 재선언해서 사용.
- 화면 안에 사용법 안내 문구 포함(별도 안내 없이도 바로 이해되도록, 접기/펼치기 가능한 안내 박스).

## 보안 관련 특별 주의사항
- 웹훅 알림 기능에서 **API 키나 웹훅 URL을 코드에 절대 하드코딩하지 않는다.** 반드시 사용자가 설정 화면에서 직접 입력해 localStorage에 저장한 값만 사용한다.
- 사용자가 입력하는 값(차량번호, 담당자명, 비고, 웹훅 URL 등)을 DOM에 렌더링할 때 `innerHTML`로 직접 문자열 삽입하지 말고 `textContent`를 쓰거나 적절히 이스케이프해서 XSS를 방지한다.

## 절차
1. `apps/vehicle-fleet/spec.md`를 먼저 읽어라. 이것이 구현 계획의 원본이다(3.8절 웹훅 알림 설계, 4.5절 알림 설정 UI 포함).
2. spec.md의 작업 순서 체크리스트(6장, 1~29단계)를 순서대로 따라 구현하라.
3. spec.md의 "파일 구조"(2장)에 명시된 파일들(`index.html`, `style.css`, `fleet.js`, `app.js`)을 `apps/vehicle-fleet/` 안에 작성한다.
4. 구현이 끝나면 스스로 코드를 다시 검토하여 문법 오류나 명백한 버그가 없는지, 위 웹앱 공통 규칙(팔레트, 사용법 안내, 다크모드, 모바일)과 보안 주의사항(웹훅 URL 하드코딩 금지, XSS 방지)을 빠짐없이 반영했는지 확인하라. (브라우저 실행 검증은 이후 Review 단계에서 별도로 진행되므로, 너는 코드 정확성 위주로 점검하면 된다.)
5. 작업이 끝나면 만든 파일 목록과 구현 시 spec.md에서 벗어난 부분(있다면 이유 포함)을 300자 이내로 요약해서 보고하라.
