# Build 서브에이전트 지침 — 픽셀 아트 에디터

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Build 단계** 서브에이전트다.
`apps/pixel-art/spec.md`에 작성된 계획대로 픽셀 아트 에디터를 실제로 구현하는 것이 임무다.

## 범위 제한 (매우 중요)
- **오직 `C:\Users\user100\Desktop\my-blog\apps\pixel-art\` 폴더 안의 파일만 생성/수정한다.**
- 블로그의 다른 파일(`index.html`, `post.html`, `/css/`, `/js/`, `/posts/`, `apps/2048/` 등 `apps/pixel-art/` 바깥의 모든 것)은 절대 건드리지 않는다.
- `apps/pixel-art/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`는 참고용이며 수정하지 않는다.

## 프로젝트 제약 조건 (CLAUDE.md 발췌)
- 순수 HTML, CSS, JavaScript만 사용. 프레임워크/빌드 도구/번들러 금지.
- 브라우저에서 파일을 그대로 열거나 정적 서버로 서빙하면 바로 동작해야 한다.
- 외부 라이브러리·CDN 사용하지 않는다.

## 절차
1. `apps/pixel-art/spec.md`를 먼저 읽어라. 이것이 구현 계획의 원본이다.
2. spec.md의 "7. 작업 순서 (Build 단계 체크리스트)"에 나온 18단계를 순서대로 따라 구현하라.
3. 다음 파일을 작성한다:
   - `apps/pixel-art/index.html`
   - `apps/pixel-art/style.css`
   - `apps/pixel-art/editor.js`
4. spec.md에 명시된 대로 다음을 반드시 포함한다:
   - 16x16 픽셀 격자, 클릭/드래그로 칠하기, 펜/지우개 도구
   - 16색 기본 팔레트 + 커스텀 컬러피커(`<input type="color">`) + 현재 선택색 표시
   - 마우스와 터치(드래그 연속 칠하기, `elementFromPoint` 활용, `touch-action: none`) 모두 지원
   - Clear(전체 지우기) 버튼
   - PNG 저장: 편집용 DOM 격자와 완전히 분리된 오프스크린 canvas로 320x320(20배 확대) 순수 도트 이미지를 만들어 다운로드. 빈 칸은 투명으로 유지.
   - 다크모드 자동(prefers-color-scheme) + 수동 토글(localStorage 저장), CSS 변수 사용
   - 반응형 레이아웃 (데스크톱 2단, 좁은 화면 세로 스택)
5. 구현이 끝나면 스스로 코드를 다시 검토하여 문법 오류나 명백한 버그가 없는지 확인하라. (브라우저 실행 검증은 이후 Review 단계에서 별도로 진행되므로, 너는 코드 정확성 위주로 점검하면 된다.)
6. 작업이 끝나면 만든 파일 목록과 구현 시 spec.md에서 벗어난 부분(있다면 이유 포함)을 300자 이내로 요약해서 보고하라.
