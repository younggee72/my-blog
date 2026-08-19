# Build 서브에이전트 지침 — 현장정산서: 업데이트 안내(What's New) 메시지 창 추가

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Build 단계** 서브에이전트다.
현장정산서 앱(`apps/settlement/`)에 "업그레이드되면 업그레이드 내용을 확인하는 메시지 창"을 추가하는 것이 임무다. 앞으로도 앱이 업데이트될 때마다 계속 쓸 수 있는 **재사용 가능한 변경사항 안내(changelog) 구조**로 만들어야 한다.

## 배경
이 앱은 최근 큰 업데이트를 거쳤다(계산서함 신설: 세금계산서 PDF/이미지/엑셀 자동인식, 공사명별 정산서 자동생성). 사용자가 다음에 접속했을 때 "뭐가 새로 생겼는지" 안내하는 팝업을 원한다. 한 번 보여주면 다시 안 뜨고, 다음 업데이트가 생기면 그때 새 안내가 또 한 번 뜨는 방식이어야 한다(매번 뜨면 안 됨).

## 범위 제한 (매우 중요)
- **오직 `apps/settlement/` 폴더 안의 파일만 수정/생성한다.** (`shared-utils.js`, `index.html`, `invoices.html`, `settlement.js`, `invoices.js`, `style.css`, `invoices.css` 중 필요한 파일)
- 프로젝트의 다른 파일(블로그 본체, 다른 앱)은 건드리지 않는다.

## 시작 전 필수: 기존 코드 읽기
`apps/settlement/shared-utils.js`, `index.html`, `invoices.html`, `settlement.js`, `invoices.js`, `style.css`를 읽어라. 이 앱은 다크모드(`prefers-color-scheme` + `[data-theme]` + localStorage), 팔레트(`/css/style.css`의 `:root` CSS 변수), localStorage 기반 상태 저장 패턴을 이미 갖고 있다 — 새로 만드는 UI도 이 패턴을 그대로 따라야 한다.

## 구현할 것

### 1. `shared-utils.js`에 변경사항(changelog) 데이터와 표시 로직 추가
- `APP_CHANGELOG` 배열을 하나 만들어라. 각 항목은 `{ version: "2.1", date: "2026-08-19", title: "...", items: ["...", "..."] }` 형태로, **최신 항목이 배열 맨 앞(또는 맨 뒤 — 일관되게)**에 오도록 하라. 첫 항목은 이번 업데이트 내용으로 채워라(아래 "채울 내용" 참고).
- localStorage 키 `settlement-app-last-seen-version`을 새로 만들어, 사용자가 마지막으로 확인한 버전을 저장한다.
- `window.SettlementShared`에 아래를 추가로 노출하라:
  - `APP_CHANGELOG` (또는 최신 버전 문자열을 알 수 있는 `getLatestVersion()`)
  - `getLastSeenVersion()` / `setLastSeenVersion(version)`
  - `showChangelogIfNeeded()` — 마지막으로 본 버전이 최신 버전과 다르면(또는 아예 없으면) 안내 창을 띄우고, 사용자가 닫으면 `setLastSeenVersion(최신버전)`을 호출해 다시 안 뜨게 한다. **처음 이 앱을 쓰는 사용자**(저장된 값이 아예 없는 경우)에게는 "새로 생긴 기능" 안내가 아니라 자연스러운 초회 안내여도 되고, 아니면 아예 안 띄우고 조용히 최신 버전으로 기록만 해도 된다 — 어느 쪽이든 스스로 합리적으로 판단해 구현하고 그 이유를 주석으로 남겨라.
- 안내 창 UI는 `alert()` 같은 네이티브 대화상자가 아니라, **사이트 팔레트를 따르는 커스�텀 모달**(오버레이 + 카드)로 만들어라. 다크모드에서도 정상적으로 보여야 한다. 배열의 모든 미확인 버전을 한 번에(또는 최신 것 하나만 — 스스로 판단) 보여주면 된다. 닫기 버튼(예: "확인" 버튼, 배경 클릭으로도 닫히게)을 포함하라.
- 이 함수를 호출하는 스타일은 함수 자체 안에서 모달 DOM을 만들어 `document.body`에 붙였다가 닫으면 제거하는 방식으로 구현하면 된다(별도 HTML 마크업을 index.html/invoices.html에 미리 넣어둘 필요 없이, JS만으로 완결되게 만드는 것을 권장한다 — 그래야 두 화면에서 재사용하기 쉽다).

### 2. `settlement.js`와 `invoices.js` 양쪽에서 호출
두 화면 모두 초기화 시점(다른 초기 렌더링/바인딩과 비슷한 시점)에 `SettlementShared.showChangelogIfNeeded()`를 호출하도록 한 줄씩 추가하라. 최초 로드 시 딱 한 번만 판단되므로, 사용자가 index.html에서 먼저 봤으면 invoices.html에서는 다시 안 뜨고, 그 반대도 마찬가지여야 한다(둘 다 같은 localStorage 키를 공유하므로 자연히 그렇게 된다).

### 3. 채울 내용 (이번 업데이트의 changelog 항목)
아래 내용을 참고해 자연스러운 한국어 문장으로 다듬어 첫 changelog 항목으로 넣어라(그대로 복붙하지 말고 사용자에게 보여줄 안내문답게 다듬어도 좋다):
- 제목 예: "계산서함이 새로 생겼어요"
- 세금계산서 PDF/이미지/엑셀(.xlsx)을 업로드하거나 폴더로 연결하면 발행일·거래처·사업자등록번호·공급가액·부가세·합계를 자동으로 읽어옵니다.
- 공사명별로 계산서를 모아서 정산서 작성 화면에 한 번에 반영(자동 생성)할 수 있습니다.
- 정산서 작성 화면 상단에 "저장된 정산서 불러오기"가 추가되어, 여러 공사의 정산서를 한 화면에서 오가며 관리할 수 있습니다.
version은 `"2.1"`로, date는 `"2026-08-19"`로 하라.

## 검증
1. `node --check apps/settlement/shared-utils.js apps/settlement/settlement.js apps/settlement/invoices.js`로 문법 검증.
2. 브라우저 프리뷰로 `index.html`을 열어(localStorage를 비운 새 세션 가정, 또는 개발자도구로 `settlement-app-last-seen-version` 키를 지우고 새로고침) 안내 창이 실제로 뜨는지 확인하라. 닫은 뒤 새로고침하면 다시 안 뜨는지도 확인하라.
3. `invoices.html`에서도 같은 방식으로 확인하되, 이미 index.html에서 확인한 뒤라면(같은 브라우저 세션) 다시 뜨지 않아야 한다 — localStorage 키를 지운 뒤 이번엔 invoices.html을 먼저 열어서 거기서도 정상적으로 뜨는지 확인하라.
4. 라이트/다크 모드 양쪽에서 모달이 잘 보이는지(텍스트 대비, 배경) 확인하라.
5. 모바일 폭(375px)에서도 모달이 화면을 벗어나지 않는지 확인하라.
6. 기존 기능(정산서 입력/저장, 계산서 업로드 등)에 회귀가 없는지 확인하라.
7. `invoices.html`/`index.html`의 `<script>` 캐시 버스팅 쿼리스트링 버전이 있다면(예: `?v=13`, `?v=6`), 이번에 수정한 파일들의 버전을 하나씩 올려라.

## 보고
작업이 끝나면 무엇을 만들었는지, 검증 결과를 400자 이내로 요약해서 보고하라.
