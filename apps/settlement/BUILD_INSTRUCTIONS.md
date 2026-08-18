# Build 서브에이전트 지침 — 현장정산서 자동화 도구 (settlement)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Build 단계** 서브에이전트다.
`apps/settlement/spec.md`에 작성된 계획대로 현장정산서 자동화 도구를 실제로 구현하는 것이 임무다.

## 범위 제한 (매우 중요)
- **오직 `apps/settlement/` 폴더 안의 파일만 생성/수정한다.**
- 프로젝트의 다른 파일(`index.html`, `post.html`, `/css/`, `/js/`, `/posts/`, 다른 `apps/*/` 폴더 — 특히 `apps/2048/`, `apps/pixel-art/`)은 절대 건드리지 않는다.
- `apps/settlement/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`는 참고용이며 수정하지 않는다.

## 프로젝트 제약 조건
- 순수 HTML, CSS, JavaScript만 사용. 빌드 도구/번들러 없음.
- 외부 라이브러리 사용은 최소화하되, 이 앱은 엑셀 내보내기를 위해 CDN의 SheetJS(xlsx.full.min.js)를 사용한다.
- 모든 웹앱은 `/apps/{앱이름}/` 폴더 안에 자체 완결된다.
- 모바일에서도 사용할 수 있어야 한다.

## 웹앱 공통 규칙 (spec.md와 함께 반드시 지킬 것)
- `apps/settlement/` 폴더 안에서 자체 완결.
- 외부 라이브러리 최소화(SheetJS CDN만 예외적으로 허용).
- 모바일 지원(터치 입력, 표 가로 스크롤 포함).
- 다크모드 지원. 이 프로젝트는 `document.documentElement`의 `data-theme` 속성을 `light`/`dark`로 토글하고 `localStorage`에 저장하며, `prefers-color-scheme: dark` 미디어 쿼리로 시스템 기본값을 따르는 패턴을 쓴다 (참고: `js/theme.js`). settlement.js 안에 동일한 메커니즘을 별도 localStorage 키(`"settlement-app-theme"`)로 자체 구현할 것 (앱이 독립적으로 완결되어야 하므로 `js/theme.js`를 직접 import하지 않는다).
- 사이트 색상 팔레트를 따를 것. `/css/style.css`에 정의된 실제 변수: `--color-bg: #ffffff`, `--color-bg-secondary: #f5f5f5`, `--color-text: #1a1a1a`, `--color-text-secondary: #595959`, `--color-accent: #2563eb`, `--color-border: #e5e5e5`, `--color-code-bg: #f0f0f0` (다크모드 값: `--color-bg: #121212`, `--color-bg-secondary: #1e1e1e`, `--color-text: #e8e8e8`, `--color-text-secondary: #a8a8a8`, `--color-accent: #60a5fa`, `--color-border: #333333`, `--color-code-bg: #1e1e1e`). 앱이 사이트 CSS를 직접 로드하지 않으므로 이 변수들을 `apps/settlement/style.css`의 `:root`에 동일한 값으로 자체 정의하고, 라이트/다크 각각의 미디어쿼리·`[data-theme]` 규칙도 동일한 이중 구조로 자체 작성한다.
- 화면 안에 사용법 안내 문구 포함(별도 안내 없이도 바로 이해되도록).

## 절차
1. `apps/settlement/spec.md`를 먼저 읽어라. 이것이 구현 계획의 원본이다.
2. spec.md의 "6. 작업 순서(Build 단계 체크리스트)" 25단계를 순서대로 따라 구현하라.
3. spec.md의 "2. 파일 구조"에 명시된 파일들(`index.html`, `style.css`, `settlement.js`)을 `apps/settlement/` 안에 작성한다.
4. 계산 로직(부가세, 합계, 잔액, 소계, 정산 요약 A/B)은 spec.md의 "3. 핵심 로직 설계"에 적힌 수식을 그대로 구현한다 — 임의로 로직을 바꾸지 않는다.
5. 실제 회사명/거래처/금액 등 민감한 예시 데이터를 절대 하드코딩하지 않는다. 빈 템플릿 상태(표마다 빈 값의 기본 행 1개, 또는 완전히 빈 배열)로 시작해야 한다.
6. 구현이 끝나면 스스로 코드를 다시 검토하여 문법 오류나 명백한 버그가 없는지, 위 웹앱 공통 규칙(팔레트, 사용법 안내, 다크모드, 모바일, 민감정보 미포함)을 빠짐없이 반영했는지 확인하라. (브라우저 실행 검증은 이후 Review 단계에서 별도로 진행되므로, 너는 코드 정확성 위주로 점검하면 된다.)
7. 작업이 끝나면 만든 파일 목록과 구현 시 spec.md에서 벗어난 부분(있다면 이유 포함)을 300자 이내로 요약해서 보고하라.
