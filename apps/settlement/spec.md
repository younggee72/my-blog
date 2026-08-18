# 현장정산서 자동화 도구 구현 계획 (spec.md)

## 1. 개요

건설 현장의 정산 업무에서 실제로 쓰이는 엑셀 정산서 양식(공사 기본 정보 → 외주·자재비/노무비/기타 협회·보증서 3개 지출 내역 표 → 세금계산서 대비 지출 비교 및 수익 정산 요약)을 그대로 재현한 웹 기반 계산기다. 사용자는 공사명과 공급가액을 입력하고, 3개의 지출 내역 표에 행을 추가하며 각 항목을 입력하면 부가세·합계·잔액 등이 즉시 자동 계산되고, 하단의 두 정산 요약표(세금계산서 대비 지출 비교, 수익 정산표)도 실시간으로 갱신된다. 모든 계산 로직은 원본 엑셀 수식을 그대로 옮긴 것이며 임의로 변경하지 않는다. 공개 포트폴리오 카드로 게시되므로 실제 회사/거래처 데이터는 전혀 포함하지 않고 완전히 빈 템플릿 상태의 범용 계산기로 제공한다. 입력값은 `localStorage`에 자동 저장되어 새로고침 후에도 유지되며, "엑셀로 내보내기" 버튼으로 SheetJS를 이용해 원본과 유사한 구조의 `.xlsx` 파일을 다운로드할 수 있다. 순수 HTML/CSS/JavaScript로만 구현하며 `/apps/settlement/` 폴더 안에서 완결되는 정적 웹앱으로 만든다.

## 2. 파일 구조

```
/apps/settlement/
  index.html   진입점. 마크업 구조(헤더, 사용법 안내, 상단 기본정보, 3개 지출 내역 표, 정산 요약 A/B, 계좌 정보란, 액션 버튼)와 css/js 로드
  style.css    레이아웃, 표/카드 스타일, 다크모드, 반응형(가로 스크롤 표) 스타일
  settlement.js  데이터 상태, 표 행 추가/삭제, 자동 계산, localStorage 저장/복원, 엑셀 내보내기, 다크모드 토글
```

- 이미지 등 외부 리소스는 사용하지 않는다.
- 엑셀 내보내기를 위해서만 CDN의 SheetJS(`xlsx.full.min.js`)를 `index.html`에 `<script>` 태그로 로드한다. 그 외 외부 라이브러리는 사용하지 않는다.

## 3. 핵심 로직 설계

### 3.1 데이터 구조

전체 상태를 하나의 전역 객체 `state`로 관리한다.

```js
state = {
  projectInfo: {
    name: "",              // 공사명
    supplyAmount: 0        // 공급가액 (숫자)
    // 부가세, 합계는 저장하지 않고 항상 supplyAmount로부터 파생 계산(단일 진실 원천 유지)
  },

  // 표 1: 외주·자재비
  subcontract: [
    {
      id: 1,                       // 내부 고유 id (행 추가/삭제 키로 사용, 순번과는 별개)
      workType: "",                // 공종
      issueDate: "",               // 발행일 (yyyy-mm-dd)
      vendor: "",                  // 거래처
      bizRegNo: "",                // 사업자등록번호
      supplyAmount: 0,             // 공급가액 (입력)
      // vat = supplyAmount * 0.1 (자동, 저장은 하지 않고 렌더/계산 시점에 파생)
      // total = supplyAmount + vat (자동)
      taxInvoiceIssued: false,     // 전자세금계산서 여부 (체크박스)
      bank: "",                    // 결제은행
      payDate: "",                 // 결제일
      paidAmount: 0,                // 결제금액 (입력, 기본값 = total과 동일. 행 추가/공급가액 변경 시 사용자가 아직 수정 안 했다면 total과 동기화)
      // balance = total - paidAmount (자동)
      accountInfo: "",             // 계좌정보 (은행명/계좌번호/예금주 통합 텍스트)
      contact: "",                 // 연락처
      note: ""                    // 비고
    }
  ],

  // 표 2: 노무비
  labor: [
    {
      id: 1,
      issueDate: "",
      workerName: "",              // 인부명
      item: "",                    // 항목 (예: "8월노무비")
      supplyAmount: 0,             // 공급가액(일당, 입력)
      withholdingTax: 0            // 원천세 (입력)
      // total = supplyAmount - withholdingTax (자동)
    }
  ],

  // 표 3: 기타 협회 및 보증서
  etc: [
    {
      id: 1,
      issueDate: "",
      vendor: "",                  // 거래처 (예: 근로복지공단/국세청/구청)
      item: "",                    // 항목 (예: 고용보험료/소득세/지방세)
      supplyAmount: 0,             // 공급가액 (입력)
      vat: 0                       // 부가세 (입력 — 자동계산 아님. "공급가액×10% 채우기" 보조 버튼으로만 채워줌)
      // total = supplyAmount + vat (자동)
    }
  ],

  account: {
    bankName: "",                 // 은행명 (정산금 입금 계좌)
    accountNumber: ""             // 계좌번호
  }
}
```

- 표1·표3은 `supplyAmount`만 입력값으로 갖고 `vat`/`total`은 저장하지 않는 파생값, 표3은 예외적으로 `vat` 자체가 입력값이라 상태에 저장한다(요구사항상 자동계산 아님).
- 표2는 `supplyAmount`, `withholdingTax`가 입력값, `total`은 파생값.
- 각 행 배열의 `id`는 `nextId` 카운터(표별로 `subcontractNextId`, `laborNextId`, `etcNextId`) 를 증가시키며 발급, 삭제 후에도 재사용하지 않아 리스트 렌더링 시 `key`(DOM에서는 `data-id`)가 항상 유일하도록 한다. 화면에 보이는 "순번" 컬럼은 `id`가 아니라 배열 내 현재 인덱스(`i + 1`)로 매 렌더링 시 다시 매김한다.

### 3.2 파생 계산 함수 (원본 엑셀 수식 그대로)

```js
function calcVat(supplyAmount) { return round(supplyAmount * 0.1); }
function calcTotal(supplyAmount, vat) { return supplyAmount + vat; }
```

- 상단: `vat = calcVat(projectInfo.supplyAmount)`, `contractTotal = calcTotal(supplyAmount, vat)`.
- 표1 행: `vat = calcVat(row.supplyAmount)`, `total = calcTotal(row.supplyAmount, vat)`, `balance = total - row.paidAmount`.
- 표2 행: `total = row.supplyAmount - row.withholdingTax`.
- 표3 행: `total = row.supplyAmount + row.vat`(vat은 입력값 그대로 사용).
- 반올림은 원 단위 정수로 통일(`Math.round`)하여 부가세 계산 시 소수점 오차가 표에 노출되지 않도록 한다(원본 엑셀도 정수 원화 기준).

### 3.3 표 행 추가/삭제/재계산 로직

- 각 표마다 "행 추가" 버튼 → `addRow(tableName)`: 새 빈 행 객체를 생성(모든 텍스트 필드 `""`, 숫자 필드 `0`)해 해당 배열의 끝에 push, `id`는 카운터에서 발급. 표1의 `paidAmount`는 신규 행 생성 시 `0`으로 두되, 해당 행의 `supplyAmount` 입력이 바뀔 때 "사용자가 결제금액을 아직 한 번도 직접 수정하지 않았다면" `total`과 자동 동기화되도록 행에 내부 플래그 `paidAmountTouched: false`를 둔다. 사용자가 결제금액 입력창을 직접 편집하면 `paidAmountTouched = true`로 바뀌어 이후 자동 동기화를 멈춘다.
- 각 행 마지막 컬럼에 "삭제" 버튼 → `removeRow(tableName, id)`: `id`로 배열에서 해당 행을 `filter`로 제거.
- 행 추가/삭제/입력값 변경 시 공통으로 `recalcAndRender()`를 호출하는 구조:
  1. 입력 이벤트(각 셀의 `input`/`change`)가 발생하면 해당 값을 `state`의 해당 필드에 반영.
  2. `renderTable(tableName)`으로 해당 표의 파생 컬럼(부가세/합계/잔액)과 소계 행을 다시 계산해 DOM에 반영.
  3. `renderSummary()`로 하단 정산 요약 A/B를 다시 계산해 반영.
  4. `saveToLocalStorage()`로 전체 `state`를 저장.
  이 4단계를 하나의 `onStateChange()` 함수로 묶어 모든 입력 핸들러에서 재사용한다(중복 방지).
- 이벤트 위임: 각 표의 `<tbody>` 하나에 `input`/`change`/`click` 리스너를 하나씩만 등록하고, `event.target.closest('tr')`의 `data-id`와 `event.target.dataset.field`로 어떤 행의 어떤 필드인지 판별한다(행이 수백 개로 늘어나도 리스너 수가 고정됨).

### 3.4 소계 계산

- `subtotal(rows, fields)` 공통 헬퍼: 표1은 `{supplyAmount, vat, total}` 세 값의 합, 표2는 `{supplyAmount, withholdingTax, total}` 합, 표3은 `{supplyAmount, vat, total}` 합을 각각 계산해 반환. 각 표의 `<tfoot>` 소계 행에 반영.

### 3.5 정산 요약 계산 로직

**요약 A (세금계산서 대비 지출 비교)** — 상단 공급가액/부가세/합계 3개 열 기준:

```
세금계산서발행금액 = { supplyAmount: projectInfo.supplyAmount, vat, total: contractTotal }
매입자료금액       = subtotal(subcontract)          // 표1 소계
노무비             = subtotal(labor)                 // 표2 소계 (공급가액/합계만 의미 있음, 부가세 열은 0으로 표시하거나 "-" 처리: 표2에는 부가세 개념이 없으므로 요약 A의 "부가세" 열에는 0을 넣는다)
기타보증서         = subtotal(etc)                    // 표3 소계
잔여마진 = 세금계산서발행금액 - 매입자료금액 - 노무비 - 기타보증서   // 공급가액/부가세/합계 열별로 각각 계산
```
- 표2(노무비)에는 "부가세" 컬럼이 없으므로 요약 A의 노무비 행 부가세 열은 `0`으로 고정하고, 공급가액 열은 표2 소계의 `supplyAmount`, 합계 열은 표2 소계의 `total`을 사용한다(스펙 25번 요구사항의 "표2 소계"를 열별로 대응).

**요약 B (수익 정산표)**:

```
공급가액   = projectInfo.supplyAmount
기술료     = 공급가액 * 0.05                 // 주석: "공급가액 × 5%"
경비       = subtotal(etc).supplyAmount      // 표3 소계 공급가액. 주석: "건설공제조합/전력 및 수도광열비 등"
매입액     = subtotal(subcontract).supplyAmount  // 표1 소계 공급가액
노무비     = subtotal(labor).total           // 표2 소계 합계
잔여금액   = 공급가액 - 기술료 - 경비 - 매입액 - 노무비
```

- `renderSummary()`는 위 두 계산을 매번 상단 정보 + 3개 표 배열로부터 처음부터 다시 계산한다(중간 캐시를 두지 않아 값 불일치 가능성을 원천 차단).

### 3.6 localStorage 저장 방식

- 저장 키: `"settlement-app-state"` 하나에 `state` 객체 전체를 `JSON.stringify`로 직렬화해 저장.
- 저장 시점: `onStateChange()` 내부, 즉 모든 입력값 변경·행 추가·행 삭제 직후마다 저장(디바운스 없이 매번 저장 — 표 규모상 성능 문제 없음).
- 페이지 로드 시 `DOMContentLoaded`에서 `localStorage.getItem("settlement-app-state")`를 읽어 존재하면 `JSON.parse` 후 `state`에 병합, 없으면 `createEmptyState()`로 빈 템플릿 초기 상태 사용(표는 각각 빈 배열이 아니라 안내용 빈 행 1개씩을 기본으로 넣어 사용자가 표 구조를 바로 인지할 수 있게 함 — 값은 전부 빈 문자열/0).
- 다크모드 설정은 별도 키 `"settlement-app-theme"`로 관리(다른 앱들과 동일 패턴, 이 앱은 상태와 테마를 분리 저장해 초기화 버튼이 테마까지 지우지 않도록 함).
- "초기화" 버튼: `confirm("모든 입력 데이터를 초기화하시겠습니까?")` 확인 후 `localStorage.removeItem("settlement-app-state")` 실행, `state`를 `createEmptyState()`로 재설정, `renderAll()` 재호출. 테마 키는 건드리지 않는다.

### 3.7 엑셀 내보내기 시트 레이아웃 설계

- SheetJS `XLSX.utils.aoa_to_sheet()`(2차원 배열 → 시트)를 사용해 하나의 워크시트 "정산서"를 구성한다. 행 순서:
  1. 제목 행: `["현장정산서"]`
  2. 빈 행
  3. 상단 정보: `["공사명", projectInfo.name]`, `["공급가액", supplyAmount]`, `["부가세", vat]`, `["합계(계약금액)", contractTotal]`
  4. 빈 행
  5. `["1. 외주·자재비"]` 헤더 행 다음 컬럼 헤더 행(순번/공종/발행일/거래처/사업자등록번호/공급가액/부가세/합계/전자세금계산서/결제은행/결제일/결제금액/잔액/계좌정보/연락처/비고), 이어서 데이터 행 각각, 마지막에 소계 행.
  6. 빈 행
  7. `["2. 노무비"]` + 컬럼 헤더(순번/발행일/인부명/항목/공급가액/원천세/합계) + 데이터 행 + 소계 행.
  8. 빈 행
  9. `["3. 기타 협회 및 보증서"]` + 컬럼 헤더(순번/발행일/거래처/항목/공급가액/부가세/합계) + 데이터 행 + 소계 행.
  10. 빈 행
  11. `["요약 A. 세금계산서 대비 지출 비교"]` + 헤더(구분/공급가액/부가세/합계) + 4개 항목 행(세금계산서발행금액/매입자료금액/노무비/기타보증서) + 잔여마진 행.
  12. 빈 행
  13. `["요약 B. 수익 정산표"]` + 항목별 2열(항목명/금액) 행: 공급가액, 기술료(주석 포함 별도 셀 또는 항목명에 괄호 병기), 경비(주석 포함), 매입액, 노무비, 잔여금액.
  14. 빈 행
  15. `["입금 계좌", account.bankName + " " + account.accountNumber]`
- 컬럼 폭은 `worksheet['!cols']`로 대략적인 문자수 기반 폭을 지정해 가독성을 확보(필수는 아니지만 권장 처리).
- `XLSX.utils.book_new()` → `XLSX.utils.book_append_sheet(wb, ws, "정산서")` → `XLSX.writeFile(wb, "현장정산서.xlsx")`로 다운로드.
- 파일명은 공사명이 입력되어 있으면 `현장정산서_{공사명}.xlsx`(파일명에 부적합한 문자는 간단히 제거/치환), 없으면 `현장정산서.xlsx`.

## 4. 입력 처리

### 4.1 행 추가/삭제 UI

- 각 표 하단에 "+ 행 추가" 버튼을 두어 클릭 시 `addRow()` 호출 후 새로 추가된 행이 보이도록 표 컨테이너를 아래로 살짝 스크롤(선택 사항).
- 각 데이터 행의 마지막 컬럼(또는 첫 컬럼 옆 고정 컬럼)에 삭제 아이콘 버튼(`×` 또는 "삭제") 배치. 클릭 시 `confirm()` 없이 즉시 삭제(행 단위 삭제는 되돌리기 쉬운 조작이므로 확인창 생략, 단 "초기화"처럼 전체 데이터를 지우는 조작에는 확인창 유지).

### 4.2 숫자 입력 포맷

- 금액 입력 필드(`supplyAmount`, `withholdingTax`, `vat`, `paidAmount` 등)는 `type="text"` + `inputmode="numeric"`로 두고 표시할 때 `toLocaleString('ko-KR')`로 천단위 콤마를 적용, 저장/계산 시에는 콤마를 제거한 순수 숫자로 파싱하는 방식을 취한다(`type="number"`는 콤마 표시가 불가능하므로 채택하지 않음).
- 포맷 처리 흐름: `focus` 시 콤마 없는 순수 숫자로 바꿔 편집하기 쉽게 하고, `blur` 시 `formatNumber()`로 콤마를 다시 적용하는 "편집 중/표시 중" 전환 패턴을 사용(일반적인 금액 입력 UX 패턴).
- 파생 계산(부가세/합계/잔액) 표시 셀은 입력 불가능한 읽기 전용(`<span>` 또는 `readonly input`)으로 두고 항상 콤마 포맷 숫자로 표시.
- 음수 입력은 막지 않는다(잔액이 음수가 되는 것은 정상적인 경우이므로).

### 4.3 모바일 터치/스크롤 충돌 방지

- 표는 각각 `.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }` 컨테이너로 감싸 가로 스크롤이 표 내부에서만 발생하도록 하고, 세로 스크롤(페이지 전체)과 충돌하지 않도록 별도 `touch-action` 제한은 두지 않는다(이 앱은 드래그로 그림을 그리는 유형이 아니라 일반 폼 입력이므로 픽셀아트 앱과 달리 커스텀 터치 핸들러가 필요 없음 — 표준 HTML `<table>` + CSS 스크롤 컨테이너만으로 충분).
- 체크박스(전자세금계산서 여부)와 각종 버튼은 최소 40×40px 터치 영역을 확보.
- 표 헤더 행은 `position: sticky; top: 0;`로 가로 스크롤 시에도 컬럼명이 보이도록 처리(선택 사항, 여유 있으면 적용).

## 5. UI/디자인

### 5.1 레이아웃 구성 (세로 순서)

1. 헤더: 앱 제목("현장정산서 자동화 도구") + 다크모드 토글 버튼(우측).
2. 사용법 안내 박스: 헤더 바로 아래, 이 도구가 무엇이고 어떻게 쓰는지(공사 정보 입력 → 지출 내역 표 작성 → 하단 요약 자동 계산 → 엑셀로 내보내기) 3~4줄로 설명. 실제 데이터가 아닌 예시 템플릿이라는 점도 명시.
3. 상단 기본 정보 카드: 공사명, 공급가액 입력, 부가세/합계 자동 표시.
4. 지출 내역 표 3개를 순서대로(외주·자재비 → 노무비 → 기타 협회 및 보증서) 각각 `<section>` + 제목 + 표(가로 스크롤 컨테이너) + 소계 행 + "행 추가" 버튼으로 구성.
5. 정산 요약 A(세금계산서 대비 지출 비교) 카드/표.
6. 정산 요약 B(수익 정산표) 카드/표(기술료·경비 항목에 주석 텍스트 작게 병기).
7. 계좌 정보란: 은행명/계좌번호 입력 필드 2개.
8. 액션 버튼 영역(하단 고정 또는 페이지 최하단): "엑셀로 내보내기", "초기화".

### 5.2 다크모드 대응

- `/css/style.css`의 기존 변수명을 그대로 참조: `--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`. 앱 자체 CSS 파일(`style.css`)에서는 새 변수를 재정의하지 않고 이 변수들을 직접 사용한다(단, 표 헤더 배경이나 소계 행 강조색 등 앱 전용 보조 색이 필요하면 `--settlement-*` 접두사로 별도 변수를 추가하되 값은 위 팔레트 변수를 참조해서 구성).
- 다크모드 전환 메커니즘은 `js/theme.js`와 동일한 패턴을 앱 내부 `settlement.js`에 그대로 재구현: `document.documentElement`의 `data-theme` 속성 토글, `localStorage`(`"settlement-app-theme"` 키)에 저장, `prefers-color-scheme: dark` 미디어 쿼리로 시스템 기본값 대응. 토글 버튼 아이콘은 ☀️/🌙로 동일하게 사용.
- CSS 쪽 다크모드 규칙도 `/css/style.css`와 동일한 이중 구조를 따른다: `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ... } }`와 `:root[data-theme='dark'] { ... }`를 앱 `style.css`에도 작성(앱이 `/css/style.css`를 직접 로드하지 않고 독립적이므로 필요한 변수 정의를 앱 내부에 자체 보유해야 함 — 값은 사이트와 동일하게 맞춘다).

### 5.3 반응형(가로 스크롤 표) 처리

- 데스크톱(넓은 화면)에서는 표가 컨테이너 폭에 맞게 자연스럽게 표시.
- 좁은 화면(모바일)에서는 각 표를 `.table-scroll { overflow-x: auto; }`로 감싸 가로 스크롤. 스크롤 가능함을 사용자가 인지하도록 표 좌우 가장자리에 은은한 그림자(fade) 또는 안내 텍스트("좌우로 스크롤하세요")를 표 위에 작게 표시.
- 상단 기본 정보, 정산 요약 A/B, 계좌 정보란은 표가 아닌 카드/폼 레이아웃이므로 `grid`/`flex-wrap`으로 좁은 화면에서 1열로 쌓이도록 구성.
- 액션 버튼(엑셀 내보내기/초기화)은 모바일에서 폭 100%로 세로 배치.
- 최소 지원 폭 320px 기준으로 레이아웃 확인.

### 5.4 사용법 안내 문구 배치

- 페이지 최상단, 헤더 바로 아래에 고정 배치되는 안내 박스(`--color-bg-secondary` 배경 + `--color-border` 테두리)로 항상 먼저 눈에 띄도록 한다. 별도 도움말 페이지나 모달로 분리하지 않는다.

## 6. 작업 순서 (Build 단계 체크리스트)

1. `apps/settlement/index.html` 뼈대 작성: 헤더(제목 + 다크모드 토글), 사용법 안내 박스, 상단 기본 정보 폼, 3개 표(각 `<table>` + `.table-scroll` 컨테이너 + `<tfoot>` 소계 + 행 추가 버튼), 정산 요약 A/B 표, 계좌 정보란, 액션 버튼(엑셀 내보내기/초기화), SheetJS CDN `<script>` 태그, `style.css`/`settlement.js` 링크.
2. `apps/settlement/style.css`에 라이트 모드 CSS 변수(사이트 팔레트와 동일한 값)와 기본 레이아웃(카드, 표, 폼 그리드) 스타일 작성.
3. 다크모드 CSS(`prefers-color-scheme` + `[data-theme]`) 및 표/소계/버튼 색상 대응 추가.
4. `settlement.js`에 `state` 초기 구조(`createEmptyState()`), 표별 `nextId` 카운터, localStorage 키 상수 정의.
5. 상단 기본 정보 입력 바인딩: 공사명/공급가액 입력 이벤트 → `state.projectInfo` 갱신 → 부가세/합계 자동 표시 갱신.
6. 표1(외주·자재비) 렌더링 함수 구현: 행 배열 → `<tbody>` DOM 생성, 순번 자동 매김, 부가세/합계/잔액 자동 계산 표시, 전자세금계산서 체크박스, 행 추가/삭제 버튼 이벤트(이벤트 위임)까지 포함해 완결.
7. 표1 소계 계산 및 `<tfoot>` 반영, `paidAmount` 기본값 동기화(`paidAmountTouched` 플래그) 로직 구현.
8. 표2(노무비) 렌더링·계산·행 추가/삭제 구현(표1과 동일한 패턴 재사용, 컬럼만 다름).
9. 표3(기타 협회 및 보증서) 렌더링·계산·행 추가/삭제 구현, "공급가액×10% 채우기" 보조 버튼(선택 기능) 추가.
10. 정산 요약 A(세금계산서 대비 지출 비교) 계산 및 렌더링 함수 구현.
11. 정산 요약 B(수익 정산표) 계산 및 렌더링 함수 구현(기술료/경비 주석 텍스트 포함).
12. 계좌 정보란 입력 바인딩(은행명/계좌번호 → `state.account`).
13. `onStateChange()` 공통 함수로 "입력 반영 → 표 재계산 → 요약 재계산 → localStorage 저장" 흐름 통합, 모든 입력 핸들러가 이를 호출하도록 연결.
14. localStorage 저장/복원 구현: 페이지 로드 시 저장된 state 복원, 없으면 빈 템플릿(표마다 기본 행 1개) 사용.
15. 숫자 입력 천단위 콤마 포맷(`focus`/`blur` 전환 패턴) 구현 및 모든 금액 입력 필드에 적용.
16. "초기화" 버튼 구현: `confirm()` 후 localStorage(state 키만) 삭제 + `state` 재생성 + 전체 재렌더링.
17. 엑셀 내보내기 구현: `buildExportSheet()`로 3.7절 레이아웃대로 2차원 배열 구성 → SheetJS `aoa_to_sheet`/`writeFile`로 `.xlsx` 다운로드.
18. 다크모드 수동 토글 구현(`js/theme.js` 패턴 재구현, 별도 localStorage 키 사용).
19. 가로 스크롤 표 컨테이너 및 반응형 레이아웃(모바일 1열 스택) 스타일 점검.
20. 라이트/다크 모드 각각에서 전체 화면 육안 점검(표, 카드, 버튼, 입력 필드 대비 확인).
21. 계산 로직 수동 검증: 공급가액 입력 → 부가세/합계 확인, 표1~3에 임의 값 입력 후 소계·잔여마진·잔여금액이 수식대로 정확히 나오는지 계산기로 대조.
22. localStorage 유지 검증: 값 입력 후 새로고침해도 그대로 복원되는지, 초기화 버튼이 정확히 빈 템플릿으로 되돌리는지 확인.
23. 엑셀 내보내기 검증: 다운로드된 `.xlsx` 파일을 열어 상단 정보/3개 표/요약 A·B가 화면 값과 일치하는지 확인.
24. 모바일 뷰포트(360~414px)에서 표 가로 스크롤, 버튼 터치 크기, 입력 포커스 시 확대/레이아웃 깨짐 여부 확인.
25. 엣지 케이스 점검: 표에 행이 0개인 상태(전부 삭제)에서 소계가 0으로 정상 표시되는지, 결제금액을 직접 수정한 후 공급가액을 바꿔도 결제금액이 임의로 덮어써지지 않는지, 공사명 빈 값일 때 엑셀 파일명이 정상 처리되는지.
