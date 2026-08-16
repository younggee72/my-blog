# 픽셀 아트 에디터 구현 계획 (spec.md)

## 1. 개요

16×16 격자 위에 클릭(모바일은 터치)으로 도트를 찍어 그림을 그리는 미니 웹앱이다. 사용자는 화면에 제공되는 색상 팔레트(기본 스와치 + 커스텀 컬러피커)에서 색을 고른 뒤 "펜"으로 칠하거나 "지우개"로 지우며, 마우스/손가락을 누른 채 움직이면 여러 칸을 연속으로 칠할 수 있다. 완성한 그림은 버튼 클릭으로 PNG 파일로 내려받을 수 있는데, 이때 화면에 보이는 편집용 격자(칸 구분선, 여백 등 UI 스타일)가 아니라 순수한 16×16 도트 이미지를 큼직하게 확대(320×320)한 픽셀 그대로의 이미지로 저장한다. 순수 HTML/CSS/JavaScript로만 구현하며, 블로그 프로젝트의 다른 파일과 독립적으로 `/apps/pixel-art/` 폴더 안에서 완결되는 정적 웹앱으로 만든다.

## 2. 파일 구조

```
/apps/pixel-art/
  index.html   진입점. 마크업 구조(헤더, 팔레트, 격자, 도구 버튼, 저장 버튼)와 css/js 로드
  style.css    레이아웃, 격자/스와치 스타일, 다크모드, 반응형 스타일
  editor.js    픽셀 데이터 상태, 격자 렌더링, 입력 처리(마우스/터치), 팔레트 로직, PNG 내보내기, 다크모드 토글
```

- 이미지/폰트 등 외부 리소스는 사용하지 않는다.
- CDN 라이브러리도 사용하지 않는다 (규모상 불필요, 순수 JS로 충분).

## 3. 핵심 로직 설계

### 3.1 픽셀 데이터 구조

- `GRID_SIZE = 16` 상수로 격자 한 변의 칸 수를 정의.
- `pixels`: 길이 256(16×16)인 1차원 배열. 인덱스는 `row * GRID_SIZE + col`로 계산해 2차원 좌표와 매핑한다(1차원 배열이 순회/초기화/저장이 단순하므로 채택).
- 각 원소 값:
  - 색이 칠해진 칸: CSS 색상 문자열(예: `"#ff0000"`).
  - 빈 칸(투명): `null`.
- `createEmptyPixels()` 함수로 256칸을 모두 `null`로 채운 배열을 생성(초기 로드/전체 지우기 시 재사용).
- 좌표 변환 헬퍼: `indexToRowCol(i)`, `rowColToIndex(r, c)`를 두어 이후 로직에서 반복 계산을 피한다.

### 3.2 격자 UI 렌더링 방식 — CSS Grid + DOM 셀 채택

**결정: 편집용 격자는 CSS Grid로 배치한 256개의 `<div class="cell">` DOM 요소로 그리고, PNG 저장 전용으로 별도의 오프스크린 `<canvas>`를 하나 더 둔다.**

이유:
- **클릭/드래그 처리의 단순함**: DOM 셀 방식은 각 칸이 이미 하나의 요소이므로 클릭 시 `event.target`(또는 터치 시 `document.elementFromPoint`)으로 어떤 칸인지 바로 알 수 있고, 칸마다 `dataset.index`를 심어두면 좌표 계산 없이 즉시 픽셀 배열 인덱스를 얻는다. `<canvas>` 하나로 격자를 그리는 방식은 클릭 좌표 → 셀 좌표 변환(픽셀 오프셋 계산)을 직접 해야 하고, 확대/축소 시 그 계산도 같이 갱신해야 해서 상대적으로 번거롭다.
- **스타일링/다크모드 대응 용이**: 칸 테두리, 호버 표시, 빈 칸의 체크무늬(투명 표시) 등을 CSS로 자연스럽게 처리할 수 있고 다크모드 변수도 그대로 적용된다.
- **반응형**: `grid-template-columns: repeat(16, 1fr)`와 컨테이너 폭을 `min(90vw, 400px)` 등으로 지정하면 칸 크기가 자동으로 화면에 맞춰 줄어든다.
- **성능**: 256개 DOM 요소는 이 규모의 앱에서 렌더링/이벤트 처리 부담이 전혀 문제되지 않는다.
- **PNG 내보내기와의 분리**: 화면 격자는 UI(테두리, 체크무늬, 셀 간격 없음이지만 보더로 구분)를 포함하므로 그대로 캡처하면 원치 않는 선이 이미지에 남는다. 따라서 저장 시점에만 `pixels` 배열 데이터를 기반으로 순수 도트 이미지를 그리는 별도의 오프스크린 `<canvas>`(화면에는 `display:none` 또는 DOM에 아예 붙이지 않고 `document.createElement('canvas')`로 즉석 생성)를 사용해 완전히 UI와 분리한다.

렌더링 흐름:
1. 초기화 시 격자 컨테이너 안에 256개의 `div.cell`을 `document.createDocumentFragment()`로 한 번에 생성해 삽입(반복 reflow 방지). 각 div에 `data-index` 부여.
2. `pixels` 배열이 바뀔 때마다 `renderCell(index)`를 호출해 해당 div의 `style.backgroundColor`를 갱신(값이 `null`이면 배경색 제거 후 빈 칸 표시용 클래스 `empty` 추가/제거로 체크무늬 처리).
3. 전체 다시 그리기가 필요한 경우(불러오기, Clear 등)에는 `renderAll()`로 256칸을 한 번에 순회 갱신.

### 3.3 그리기/지우기 동작 및 드래그 연속 칠하기

- 도구 상태: `currentTool` 변수(`"pen"` 또는 `"eraser"`), 기본값 `"pen"`.
- 색상 상태: `currentColor` 변수(마지막으로 선택한 팔레트 색 또는 커스텀 색).
- 드래그 상태: `isDrawing` boolean 플래그.
- `applyToolAt(index)` 함수: `currentTool === "pen"`이면 `pixels[index] = currentColor`, `"eraser"`면 `pixels[index] = null`로 설정 후 `renderCell(index)` 호출. 같은 값이면 불필요한 렌더링을 생략해도 되지만 256칸 규모에서는 최적화 없이도 충분.
- 마우스:
  - `mousedown` on 셀 → `isDrawing = true`, `applyToolAt(index)` 즉시 실행(클릭만 해도 한 칸은 칠해지도록).
  - `mousemove`(격자 컨테이너에 위임, 버블링 이용) → `isDrawing`이 true이고 `event.target`이 `.cell`이면 해당 인덱스에 `applyToolAt` 실행. 같은 칸에서 계속 움직여도 값 재대입은 무해하므로 별도 캐시 불필요.
  - `mouseup`(문서 전체에 등록, 격자 밖에서 버튼을 놓아도 드래그가 멈추도록) → `isDrawing = false`.
- 터치:
  - `touchstart` on 격자 컨테이너 → `isDrawing = true`, 시작 지점 좌표로 대상 셀을 찾아 `applyToolAt` 실행.
  - `touchmove` → `event.preventDefault()`로 페이지 스크롤 방지 후, `event.touches[0]`의 `clientX/clientY`를 `document.elementFromPoint(x, y)`에 넘겨 실제로 손가락이 위치한 DOM 요소(셀)를 찾는다(터치 이벤트는 시작 대상에게만 계속 전달되므로 `elementFromPoint`가 필수). 반환된 요소가 `.cell`이면 인덱스 추출 후 `applyToolAt` 실행.
  - `touchend`/`touchcancel` → `isDrawing = false`.
- 이벤트 리스너는 셀 256개 각각이 아니라 격자 컨테이너 하나에 위임(event delegation)해 등록 개수를 최소화한다.

### 3.4 PNG 저장 로직

- 상수 `EXPORT_SCALE = 20` (16 × 20 = 320px 결과물. 확대 배율은 필요 시 조정 가능하도록 상수로 분리).
- `exportToPng()` 함수:
  1. `document.createElement('canvas')`로 오프스크린 캔버스 생성, `width = height = GRID_SIZE * EXPORT_SCALE` (320×320) 설정. DOM에 붙이지 않고 메모리 상에서만 사용.
  2. `ctx = canvas.getContext('2d')`, `ctx.imageSmoothingEnabled = false`(확대해도 흐려지지 않도록, 다만 이 방식은 셀 단위로 직접 사각형을 그리므로 실질적 영향은 적지만 안전하게 설정).
  3. `pixels` 배열을 순회하며 각 인덱스를 `row, col`로 변환, 값이 `null`이 아니면 `ctx.fillStyle = color; ctx.fillRect(col * EXPORT_SCALE, row * EXPORT_SCALE, EXPORT_SCALE, EXPORT_SCALE)` 실행. 값이 `null`인 칸은 그리지 않아 캔버스 기본 투명 배경이 그대로 유지되어 PNG 저장 시 투명 픽셀로 남는다(배경색 칠하기를 하지 않음 — 순수 도트 + 투명 배경).
  4. `canvas.toDataURL('image/png')`로 데이터 URL 생성(또는 `canvas.toBlob` + `URL.createObjectURL`도 대안으로 언급하되, 구현 단순성을 위해 `toDataURL` 채택).
  5. `<a>` 엘리먼트를 동적으로 생성해 `href`에 데이터 URL, `download = "pixel-art.png"` 지정 후 `a.click()`으로 다운로드 트리거. DOM에 붙이지 않고 즉시 사용 후 버림(`a.remove()` 불필요하지만 안전하게 처리해도 무방).
  6. 이 과정은 화면의 편집 격자(`div.cell`들)와 완전히 무관하게 `pixels` 데이터 배열만을 참조하므로, UI 스타일(테두리·체크무늬)이 결과 이미지에 절대 섞이지 않는다.

## 4. 색상 팔레트 설계

- 기본 팔레트 16색(무채색 4 + 유채색 12 구성 제안):
  - 무채색: `#000000`(검정), `#7f7f7f`(회색), `#c3c3c3`(밝은 회색), `#ffffff`(흰색)
  - 유채색: `#ff0000`(빨강), `#ff7f27`(주황), `#ffff00`(노랑), `#22b14c`(초록), `#00a2e8`(하늘), `#3f48cc`(파랑), `#a349a4`(보라), `#ff00ff`(마젠타), `#ffaec9`(분홍), `#b97a57`(갈색), `#873600`(진갈색), `#00ff00`(연두)
  - 색상 배열은 `editor.js` 상단에 `DEFAULT_PALETTE = [...]` 상수로 선언해 이후 조정이 쉽도록 한다.
- 팔레트 UI: 각 색을 `button.swatch`로 렌더링(배경색 = 해당 색), 클릭 시 `currentColor`를 그 색으로 설정하고 `currentTool`을 `"pen"`으로 전환(지우개 상태에서 팔레트를 클릭하면 자동으로 펜 도구로 복귀해 바로 그릴 수 있도록).
- 커스텀 색상: `<input type="color" id="customColorPicker">` 하나를 팔레트 영역에 추가. `input` 이벤트에서 `currentColor = event.target.value` 설정 및 펜 도구로 전환. 커스텀 색 선택 시에도 "현재 선택 색상" 표시기가 그 값으로 갱신되도록 연동.
- 현재 선택 색상 표시: 팔레트 옆(또는 위)에 `div#currentColorIndicator`를 두어 `currentColor`가 바뀔 때마다 `background-color`를 갱신. 선택된 스와치 버튼에는 `.selected` 클래스(테두리 강조)를 부여하고 다른 스와치의 `.selected`는 제거해 어떤 색이 활성 상태인지 시각적으로 표시.
- 지우개 도구가 선택된 동안에는 `currentColorIndicator`에 지우개 모드임을 나타내는 별도 표시(예: 체크무늬 배경 또는 텍스트 "지우개")를 보여줘 헷갈리지 않게 한다.

## 5. 입력 처리 (모바일 스크롤 충돌 방지 포함)

- 격자 컨테이너(`#pixelGrid`)에 CSS로 `touch-action: none;`을 지정해 터치 드래그 시 브라우저의 기본 스크롤/줌 제스처가 발생하지 않도록 한다.
- `touchstart`, `touchmove` 리스너는 `{ passive: false }` 옵션으로 등록해 `preventDefault()`가 실제로 동작하도록 한다.
- 마우스 이벤트(`mousedown`/`mousemove`)와 터치 이벤트(`touchstart`/`touchmove`)는 별개의 리스너로 등록하되 공통 로직(`applyToolAt`)을 공유해 중복을 줄인다. `mouseup`/`touchend`는 `document`(또는 `window`) 레벨에 등록해 사용자가 격자 밖으로 나가서 손을 떼도 드래그 상태가 정확히 해제되도록 한다.
- 페이지 전체 레벨에서는 격자 밖 영역(팔레트, 버튼 등)의 터치 스크롤은 막지 않는다 — `touch-action: none`을 격자 컨테이너에만 한정해 적용.
- 데스크톱 우클릭(`contextmenu`) 이벤트는 격자 내에서 `preventDefault()`로 막아, 추후 "우클릭 = 지우개" 같은 확장을 고려할 여지를 남기되 이번 구현 범위에서는 필수 아님(선택 사항으로 명시만 해둠).

## 6. UI/디자인

### 6.1 레이아웃 구성

- 상단: 앱 제목("픽셀 아트 에디터"), 우측에 다크모드 토글 버튼.
- 그 아래 메인 영역을 데스크톱 기준 좌우 2단 구성(팔레트/도구 영역 + 격자 영역), flexbox로 배치:
  - 좌측(또는 상단, 모바일에서는 순서 변경): 색상 팔레트 스와치 그리드, 커스텀 컬러피커, 현재 선택 색 표시기, 도구 버튼(펜/지우개 — 토글 형태로 활성 도구 강조 표시), 전체 지우기(Clear) 버튼, PNG 저장(Save as PNG) 버튼.
  - 우측(또는 하단): 16×16 격자(정사각형 유지, `aspect-ratio: 1 / 1`).
- 도구 버튼 영역은 펜/지우개를 라디오 버튼 느낌의 토글 버튼(`aria-pressed`로 상태 표시)으로 구성해 현재 도구를 명확히 보여준다.
- Clear 버튼 클릭 시 `confirm()` 브라우저 기본 대화상자로 실수 방지(간단한 요구사항 범위 내에서 별도 커스텀 모달 없이 처리).

### 6.2 다크모드 대응

- 모든 색상 값(배경, 텍스트, 버튼, 격자 테두리, 스와치 테두리, 빈 칸 체크무늬 색 등)은 `:root`에 CSS 변수(`--bg`, `--surface`, `--text`, `--border`, `--cell-empty-a`, `--cell-empty-b`, `--accent` 등)로 정의.
- `@media (prefers-color-scheme: dark)`로 다크 팔레트 자동 적용.
- 헤더의 토글 버튼 클릭 시 `document.documentElement.setAttribute('data-theme', 'dark' | 'light')`로 수동 전환하고 `[data-theme="dark"]` 선택자로 변수를 오버라이드. 선택값은 `localStorage`(예: 키 `pixel-art-theme`)에 저장해 재방문 시 유지.
- 주의: 팔레트 스와치 자체의 색(빨강, 파랑 등)은 다크모드에서도 원래 색 그대로 유지하고, 스와치의 테두리/선택 표시 색상만 다크 팔레트에 맞춰 대비를 조정한다. 격자의 빈 칸(투명) 표시용 체크무늬도 다크모드에서 눈에 편하도록 별도 명도 쌍(`--cell-empty-a/b`)을 정의.

### 6.3 모바일 반응형

- 격자 컨테이너 폭: `width: min(90vw, 400px); aspect-ratio: 1 / 1;`로 지정해 화면 폭에 맞춰 자동 축소.
- 메인 레이아웃은 `flex-direction: row`(데스크톱) → 미디어 쿼리(`max-width: 640px` 등)에서 `flex-direction: column`으로 전환해 좁은 화면에서는 팔레트/도구가 격자 위(또는 아래)로 쌓이도록 한다.
- 팔레트 스와치는 `flex-wrap: wrap`으로 좁은 화면에서 여러 줄로 자동 줄바꿈.
- 버튼(펜/지우개/Clear/Save/다크모드 토글)은 터치하기 충분한 크기(최소 44×44px 권장)로 지정.
- 최소 지원 폭 320px 기준으로 레이아웃이 깨지지 않는지 확인.

## 7. 작업 순서 (Build 단계 체크리스트)

1. `apps/pixel-art/index.html` 뼈대 작성: 헤더(제목 + 다크모드 토글), 팔레트 영역(스와치 컨테이너 + 커스텀 컬러피커 + 현재색 표시기), 도구 버튼(펜/지우개), Clear 버튼, Save 버튼, 격자 컨테이너(`#pixelGrid`), css/js 링크.
2. `apps/pixel-art/style.css`에 기본 레이아웃(flexbox 2단 구성)과 라이트 모드 CSS 변수 작성.
3. 다크모드 CSS 변수 및 `prefers-color-scheme`/`[data-theme]` 대응 스타일 추가.
4. `apps/pixel-art/editor.js`에 `pixels` 배열 초기화(`createEmptyPixels`)와 격자 DOM 생성 함수(256개 `div.cell` 삽입, `data-index` 부여) 작성.
5. `renderCell`/`renderAll` 함수 구현(픽셀 값 → 셀 배경색/빈 칸 표시 반영), 초기 렌더 확인.
6. 기본 팔레트 스와치 렌더링(`DEFAULT_PALETTE` 순회해 버튼 생성) 및 클릭 시 `currentColor` 변경 + `.selected` 표시 로직 구현.
7. 커스텀 컬러피커(`input[type=color]`) 연동 및 현재 선택 색 표시기(`#currentColorIndicator`) 갱신 로직 구현.
8. 펜/지우개 토글 버튼 구현(`currentTool` 상태 전환, 활성 버튼 강조 표시).
9. 마우스 입력 처리(`mousedown`/`mousemove`/`mouseup`)로 클릭 및 드래그 연속 칠하기 구현, `applyToolAt` 연결.
10. 터치 입력 처리(`touchstart`/`touchmove`/`touchend`, `elementFromPoint` 활용, `preventDefault`) 구현 및 `touch-action: none` 스타일 적용.
11. Clear 버튼 구현(`confirm()` 후 `pixels` 초기화 + `renderAll()`).
12. PNG 저장 로직(`exportToPng`) 구현: 오프스크린 캔버스 생성, 픽셀 순회 후 `fillRect`, `toDataURL` → 다운로드 링크 클릭.
13. 다크모드 수동 토글 버튼 동작 구현 및 `localStorage` 저장/복원 연결.
14. 반응형 스타일 점검: 데스크톱 2단 레이아웃과 좁은 화면(320~640px) 세로 스택 레이아웃 모두 확인.
15. 라이트/다크 모드 각각에서 전체 화면 육안 점검.
16. 데스크톱 마우스 드래그 그리기/지우기와 모바일 터치 드래그 그리기/지우기를 모두 수동 테스트(에뮬레이터 또는 실기기).
17. PNG 저장 결과물 검증: 다운로드된 이미지가 320×320이고 격자 테두리 없이 순수 도트만 포함되어 있는지, 빈 칸이 실제로 투명하게 저장되는지 확인.
18. 엣지 케이스 점검: 아무것도 그리지 않은 상태에서 저장(완전 투명 PNG), 격자 밖에서 마우스를 뗀 뒤 드래그 상태가 정상 해제되는지, 커스텀 색 선택 후 지우개로 전환했다가 다시 펜으로 돌아왔을 때 마지막 커스텀 색이 유지되는지.
