# 현장정산서 v7 — 홈택스 목록 엑셀 일괄 불러오기 구현 계획 (spec-v7-hometax.md)

이 문서는 기존 계산서함(`invoices.html` / `invoices.js`)에 **홈택스 "전자(세금)계산서 목록조회(매출/매입)" 엑셀 내려받기 파일을 한 번에 여러 건 불러오는 기능**을 추가하는 계획이다. **코드는 작성하지 않는다.** `invoices.html`, `invoices.js`, `invoices.css`, `shared-utils.js`, `settlement.js`(projectInfo·표1 모델), `spec-v2-invoice.md`, `review-v5-excel.md`, `review-v6-xls.md`를 읽고 기존 구조를 그대로 연장하도록 설계했다.

## 1. 개요

- 지금 계산서함은 **파일 1개 = 계산서 1건** 구조다(`enqueueFile` → `processOneFile` → `extractExcelInvoiceData`/`extractXlsInvoiceData` → `extractFieldsFromText`).
- v7에서는 업로드된 `.xlsx`/`.xls`가 **홈택스 목록 파일**이면 단건 인식 경로 대신 "목록 경로"로 보내, **승인번호 1개 = 목록 1행**으로 수십 건을 한꺼번에 추가한다.
- 홈택스는 직접 API가 없고, 공동인증서·비밀번호 같은 민감정보는 다루지 않는다. 사용자가 홈택스에서 직접 내려받은 엑셀 파일만 브라우저 안에서 읽는다(서버 없음, GitHub Pages 그대로).
- 새 라이브러리는 추가하지 않는다. 이미 `invoices.html`에서 불러오는 **ExcelJS 4.4.0(.xlsx)**, **SheetJS 0.18.5(.xls)**를 그대로 쓴다.
- 저장소는 기존 `settlement-invoices-state`(localStorage)와 `settlement-invoices-db`(IndexedDB `files` 스토어)만 쓴다. 새 키나 새 DB는 만들지 않는다.
- 추가되는 것: 행 스키마 필드 몇 개(`direction`, `approvalNo`, `blobKey`, `sourceRow`), 매출/매입 구분, 승인번호 중복 방지, 체크한 행에 공사명 일괄 지정, 정산서 생성 시 매출 행을 `projectInfo.supplyAmount`로 반영.

## 2. 수정할 파일

| 파일 | 변경 내용 |
|---|---|
| `apps/settlement/invoices.js` | (핵심) 목록 판별·헤더 매핑·행 생성·중복 방지·매출/매입 확인 UI 로직, 체크박스·일괄 공사명, 구분 열 렌더, `generateSettlementForProject`에 매출 반영 추가, `resolveInvoiceFile`/삭제 시 `blobKey` 처리, 정규화 시 기존 행 호환 |
| `apps/settlement/invoices.html` | 사용법 안내 문구 보강, 업로드 카드에 "홈택스 목록 구분" 선택(자동/매출/매입)과 가져오기 결과 영역 추가, 목록 표에 체크박스 열·구분 열 추가, 표 위에 일괄 공사명 바 추가, 생성 요약에 매입/매출 합계 분리 표시, `invoices.js?v=17`→`?v=18`, `invoices.css?v=2`→`?v=3` 캐시 버스팅 |
| `apps/settlement/invoices.css` | 일괄 지정 바, 구분 배지(매출/매입), 가져오기 결과 박스, 매출/매입 선택 버튼, 체크박스 셀 너비, 모바일(≤640px) 세로 배치. 색은 기존 팔레트 변수만 사용(다크모드 자동 대응) |
| `apps/settlement/shared-utils.js` | `APP_CHANGELOG` 맨 앞에 v2.2 항목 1개 추가("홈택스 목록 엑셀을 올리면 여러 건이 한꺼번에 들어옵니다"). 다른 함수는 건드리지 않음 |

`settlement.js`, `index.html`, `completed.*`, `settlement-fixes.js`는 **수정하지 않는다**. 정산서 쪽은 이미 `projectInfo.supplyAmount`와 표1(`subcontract`)을 그대로 렌더하므로, 계산서함이 저장소에 올바른 값을 쓰기만 하면 된다.

## 3. 핵심 로직

### 3.1 행 스키마 확장 (기존 구조 재사용)

`enqueueFile`이 만드는 행 모양을 그대로 쓰고 필드 4개만 추가한다.

```js
{
  id, fileName, fileSource,             // 기존 그대로
  issueDate, vendor, workType, bizRegNo,
  supplyAmount, vat, total, projectName,
  parseMethod,                          // 목록 행은 'hometax-list' (신규 값)
  needsReview, rawText, linkedProjectRowId,

  direction: 'sales' | 'purchase',      // 신규. 없으면 'purchase'로 간주
  approvalNo: '',                       // 신규. 승인번호(하이픈 제거·trim된 문자열)
  blobKey: null,                        // 신규. 원본 blob이 저장된 IndexedDB 키(없으면 id)
  sourceRow: null                       // 신규. 목록 엑셀 안의 행 번호(사람이 읽는 1부터 시작)
}
```

- **기존 행 호환**: `normalizeInvoicesState`에서 저장된 각 행에 `direction`이 없으면 `'purchase'`로 채운다(`approvalNo`는 `''`, `blobKey`·`sourceRow`는 `null`). 이 함수 외의 코드도 `row.direction === 'sales'`인지로만 비교하므로, 값이 비어 있으면 자연스럽게 매입이다.
- `getDirection(row)` 헬퍼 하나를 두고 `return row.direction === 'sales' ? 'sales' : 'purchase'`로 통일한다.
- 단건 업로드(PDF/이미지/단건 엑셀)는 지금처럼 `direction: 'purchase'`로 만든다. 사용자는 구분 열에서 바꿀 수 있다(3.10).

### 3.2 업로드 파이프라인에서 목록 판별 위치

- 판별은 **단건 인식보다 먼저** 해야 한다. 홈택스 목록 텍스트에도 "세금계산서", "공급자", "세액"이 들어 있어, `isTaxInvoiceDocument`가 true가 되어 수십 건이 1건으로 잘못 합쳐질 수 있기 때문이다.
- `extractExcelInvoiceData(file)` / `extractXlsInvoiceData(file)` 안에서 워크북을 읽은 직후(한 번만 읽고 재사용) `detectHometaxList(grid, sheetName)`를 모든 시트에 시도한다. 목록으로 판별되면 `{ hometaxList: parsedList }`를 돌려주고, 아니면 **지금 코드 그대로** 단건 경로(`findInvoiceSheetText` → `isTaxInvoiceDocument` → `extractFieldsFromText`)를 탄다. 단건 경로 함수들은 한 줄도 바꾸지 않는다(review-v5/v6 회귀 방지).
- **시트 → 2차원 셀 배열(grid) 변환**은 형식별로 하나씩 둔다. 둘 다 결과는 `grid[r][c] = 문자열|숫자|Date|''`.
  - xlsx: `worksheetToGrid(worksheet)` — `worksheet.eachRow({includeEmpty:true})` + `row.getCell(c)`로 1..`worksheet.columnCount` 순회. 셀 값은 기존 `excelCellValueToString`을 쓰되 **숫자는 숫자로 그대로 둔다**(금액 파싱용). 병합 셀에서 주인이 아닌 칸은 `''`로 둔다(review-v5의 `cell.isMerged && cell.master !== cell` 규칙 재사용). 열 위치가 밀리지 않도록 빈 칸도 자리를 지킨다는 점이 기존 `worksheetToText`와 다르다.
  - xls: `xlsSheetToGrid(sheet)` — 기존 `xlsSheetToText`처럼 `!ref` 범위를 순회하고 `buildXlsMergeSkipSet`로 병합 칸을 `''` 처리.
- `processOneFile`에서 `result.hometaxList`가 있으면 `importHometaxList(result.hometaxList, invoiceId, file, sourceInfo)`로 넘긴다(3.6). 이때 처음에 "인식 중" 표시용으로 넣은 임시 행(`invoiceId`)은 목록에서 지우지만, **그 id로 이미 저장된 원본 blob은 지우지 않고** 새 행들의 `blobKey`로 재사용한다(3.7).
- `processOneFile`에 `sourceInfo`(fileSource)를 넘길 수 있도록 `enqueueFile` → `processOneFile(file, invoiceId, sourceInfo)` 시그니처에 인자를 하나 더한다. `retryRecognition`은 목록 행에서 호출되지 않으므로(3.7) 영향이 없다.

### 3.3 헤더 행 찾기와 목록 판별

- **이름 정규화** `normHeader(s)`: 문자열로 바꾼 뒤 공백·줄바꿈·탭 전부 제거(`/\s+/g`), 전각 괄호 `（）`를 반각으로, `·`/`/`는 그대로 둔다. 예: `"공급가액\n"`→`"공급가액"`, `"공급받는자 사업자\n등록번호"`→`"공급받는자사업자등록번호"`.
- **헤더 행 탐색**: 시트 위쪽 최대 30행을 훑어, 정규화한 셀 값들 중 `승인번호`가 들어 있는 칸과 `공급가액`이 정확히 같은 칸이 **함께 있는** 첫 행을 헤더 행으로 본다. 위쪽 행들은 제목/조회조건 줄로 취급한다.
- **판별 기준**: 위 헤더 행이 있으면 목록으로 판별. 추가로 헤더 행 아래에 승인번호 값이 1개 이상 있어야 한다(헤더만 있고 데이터가 0건이면 "목록 파일이지만 0건"으로 결과 영역에 알리고 아무 것도 추가하지 않는다).
- **2줄 헤더 대응**: 홈택스가 "공급자 / 공급받는자" 묶음 제목을 헤더 위 한 줄에 병합 셀로 두는 경우가 있을 수 있다. 헤더 행 바로 위 행에 `공급자` 또는 `공급받는자`가 있으면, 그 병합 범위(또는 다음 묶음 제목 전까지)를 열별 "그룹" 값으로 기억해 3.4의 앞뒤 구분 보조 정보로 쓴다.

### 3.4 헤더 이름 → 필드 매핑 (공급자/공급받는자 구분 포함)

열 순서가 아니라 **이름으로** 찾는다. 각 필드에 후보 이름 목록을 두고, 정규화 값이 후보와 **완전히 같은** 열을 먼저, 없으면 후보를 **포함하는** 열을 찾는다.

| 내부 키 | 후보 이름(정규화 후) | 필수 |
|---|---|---|
| `writeDate` | 작성일자, 작성일 | 필수 |
| `approvalNo` | 승인번호 | 필수(판별 기준) |
| `issueDate` | 발급일자 | 선택 |
| `sendDate` | 전송일자 | 선택 |
| `supplyAmount` | 공급가액 (정확히 일치만. `품목공급가액`과 구분) | 필수(판별 기준) |
| `vat` | 세액 (정확히 일치만. `품목세액`과 구분) | 필수 |
| `total` | 합계금액, 합계 | 필수 |
| `supplierBizNo` | 공급자사업자등록번호, 공급자등록번호 | 필수 |
| `buyerBizNo` | 공급받는자사업자등록번호, 공급받는자등록번호 | 필수 |
| `supplierName` / `buyerName` | 상호 (아래 위치 규칙) | 거래처 쪽은 필수 |
| `supplierCeo` / `buyerCeo` | 대표자명 | 선택 |
| `supplierSubNo` / `buyerSubNo` | 종사업장번호 | 선택 |
| `supplierAddr` / `buyerAddr` | 주소 | 선택 |
| `category` / `kind` | 전자세금계산서분류 / 전자세금계산서종류 | 선택 |
| `issueType` | 발급유형 | 선택 |
| `note` | 비고 (정확히 일치만. `품목비고`와 구분) | 선택 |
| `receiptType` | 영수/청구구분, 영수청구구분 | 선택 |
| `itemName` | 품목명 | 선택(공종 추정용) |
| `itemSpec`, `itemQty`, `itemPrice`, `itemSupply`, `itemVat`, `itemNote`, `itemDate` | 품목규격, 품목수량, 품목단가, 품목공급가액, 품목세액, 품목비고, 품목일자 | 선택(rawText 보관만) |

**정확히 일치만 허용하는 필드**: `공급가액`·`세액`·`비고`는 `품목공급가액`·`품목세액`·`품목비고`를 포함 검색으로 잘못 잡을 수 있으므로 포함 검색을 쓰지 않는다. 반대로 `품목…` 필드를 찾을 때는 `품목` 접두사가 있는 열만 본다.

**두 번 나오는 열(상호·대표자명·종사업장번호·주소) 구분 규칙** — 아래 순서대로 시도하고 처음 성공한 방법을 쓴다.

1. **이름에 접두사가 있는 경우**: `공급자상호`, `공급받는자상호`처럼 이름 자체에 붙어 있으면 그대로 매핑.
2. **위치 규칙(기본)**: `S = supplierBizNo 열 번호`, `B = buyerBizNo 열 번호`(B > S라고 가정). 이름이 `상호`인 열 중 **S < c < B인 첫 열 → 공급자**, **c > B인 첫 열 → 공급받는자**. 대표자명·종사업장번호·주소도 같은 규칙. 
   - 만약 B < S로 나오면(공급받는자가 먼저 오는 배치) 같은 규칙을 반대로 적용한다(각 사업자등록번호 열 **뒤**에 오는 첫 열이 그 쪽 정보).
   - 다른 쪽 사업자등록번호 열을 넘어가면 그 쪽 정보로 보지 않는다(구간을 넘지 않음).
3. **2줄 헤더 그룹 정보**: 3.3에서 기억한 "공급자/공급받는자" 그룹 값이 있으면 그것으로 구분.
4. **사업자등록번호 열 이름이 그냥 `등록번호`/`사업자등록번호`로 두 번 나오는 경우**: 그룹 정보가 있으면 그걸로, 없으면 **첫 번째 = 공급자, 두 번째 = 공급받는자**(홈택스 화면 순서)로 정하고, 결과 영역에 "공급자/공급받는자 열을 순서로 추정했습니다"라는 주의 문구를 띄운다.

매핑 결과는 `{ cols: {키: 열번호}, missingRequired: [표시이름…], guessed: [메시지…] }`로 만든다.

### 3.5 매출/매입 구분

- **자동 판별** `detectDirection(grid, headerRowIndex, sheetName, fileName)`: 헤더 행 **위쪽** 제목/조회조건 셀들과 시트 이름을 합친 문자열에서
  - `매출`만 있으면 `'sales'`, `매입`만 있으면 `'purchase'`.
  - 둘 다 있거나(예: 조회조건에 "매출/매입" 둘 다 표기) 둘 다 없으면 `null`(판별 실패).
  - 데이터 행이나 품목명은 보지 않는다(품목명에 "매입" 같은 단어가 들어갈 수 있음). 파일 이름은 마지막 보조 수단으로만 쓴다(홈택스 기본 파일명에 매출/매입이 들어가는 경우 대비).
- **사용자 선택**: 업로드 카드에 `<select id="hometax-direction">` (자동 판별 / 매출 / 매입, 기본 "자동 판별")을 둔다.
  - 사용자가 매출/매입을 직접 골랐으면 그 값을 우선한다(자동 판별 결과와 다르면 결과 영역에 "파일 제목은 매입으로 보이지만 선택하신 매출로 가져왔습니다" 한 줄 표시).
  - "자동 판별"인데 판별에 실패하면 **바로 추가하지 않고** 결과 영역에 "이 목록이 매출인지 매입인지 알 수 없습니다" 문구와 `[매출로 가져오기] [매입으로 가져오기] [취소]` 버튼을 보여준다. 파싱 결과는 메모리 변수(`pendingHometaxImports`, 저장 안 함)에 잠시 둔다. 버튼을 누르면 그 값으로 3.6을 진행하고, 취소나 새로고침이면 아무 것도 남기지 않는다(임시 저장된 blob도 삭제).
- **거래처 결정**: 매입 → 거래처·사업자등록번호 = **공급자** 상호·번호. 매출 → 거래처·사업자등록번호 = **공급받는자** 상호·번호.

### 3.6 행 생성 (`importHometaxList`)

1. 헤더 아래 행을 끝까지 돌며 승인번호 칸이 빈 행은 건너뛴다(합계 줄·빈 줄·안내 문구 줄). 승인번호는 `String(v).replace(/[\s-]/g,'')`로 정규화해 비교에 쓰고, 화면에는 원래 모양을 `rawText`에 남긴다.
2. **같은 파일 안 같은 승인번호 여러 줄**(품목이 여러 개라 줄이 나뉘는 경우)은 1건으로 묶는다. 금액(공급가액·세액·합계)은 **첫 줄 값**을 쓰고(계산서 단위 금액이 줄마다 반복된다고 가정), 품목명은 `, `로 이어 붙여 공종 추정에 쓴다. 첫 줄 금액이 0이고 품목공급가액만 있으면 품목공급가액·품목세액 합으로 채우고 `needsReview=true`.
3. 행 하나당 값:
   - `issueDate` ← 작성일자. Date 셀이면 기존 `excelCellValueToString`으로 `YYYY-MM-DD`, 문자열이면 `"2026-07-15"`, `"2026.07.15"`, `"20260715"`(8자리 숫자) 모두 `YYYY-MM-DD`로. 기존 `isValidDateParts`로 범위 검사, 실패 시 빈 값.
   - `vendor`, `bizRegNo` ← 3.5 규칙. 번호는 기존 `formatBizRegNo`.
   - `supplyAmount`/`vat`/`total` ← 각 열, 기존 `parseNumber`(콤마·음수 처리됨. 수정세금계산서의 마이너스 금액도 그대로 둔다). 합계 열이 없으면 `calcTotal(supply, vat)`.
   - `workType` ← 품목명(없으면 비고)에 기존 `extractWorkType(text)`(WORK_TYPE_KEYWORDS) 그대로 적용. 못 찾으면 빈 값.
   - `projectName` ← `''`(사용자 지정).
   - `direction`, `approvalNo`, `sourceRow`(엑셀 행 번호), `fileName`(목록 엑셀 파일 이름), `fileSource`(3.7), `blobKey`(3.7).
   - `parseMethod: 'hometax-list'`, `linkedProjectRowId: null`.
   - `rawText` ← 그 행의 "헤더이름: 값" 줄 목록(기존 "텍스트" 버튼으로 원래 엑셀 값을 확인할 수 있게. 여러 줄로 묶였으면 모두).
   - `needsReview` ← (작성일자·거래처·사업자등록번호·공급가액 중 빈 값) OR (공급가액+세액≠합계) OR (거래처 쪽 상호/번호 열을 순서 추정으로 잡음) 이면 true. 홈택스 원본 데이터이므로 이 조건이 아니면 false(기존 엑셀 경로와 같은 신뢰도).
4. 3.8의 중복 검사를 통과한 행만 `state.invoicesNextId++`로 id를 받아 `state.invoices`에 push. 한 번 `saveInvoicesState()` + `renderInvoiceTable()`.
5. 결과 영역(`#hometax-result`)에 "홈택스 매입 목록 '파일명': 새로 추가 N건, 중복 건너뜀 M건" (+ 3.11 경고) 표시. 추가된 행이 0건이면 blob도 지운다(3.7).

### 3.7 원본 참조 (엑셀 1개 ↔ 여러 행)

- **업로드(blob) 경우**: 지금처럼 `enqueueFile`이 임시 행 id로 파일을 `files` 스토어에 저장한다. 목록으로 판별되면 그 키(임시 id)를 그대로 `blobKey`로 쓰고, 새로 만든 모든 행이 같은 `blobKey`를 가리킨다. 파일은 **한 번만** 저장된다.
  - `resolveInvoiceFile(row)`의 blob 분기를 `getStoredFile(row.blobKey != null ? row.blobKey : row.id)`로 바꾼다(기존 행은 `blobKey`가 없어 기존과 동일).
  - 행 삭제 시 `deleteStoredFile`은 **같은 `blobKey`를 가진 다른 행이 하나도 남지 않을 때만** 호출한다(`blobKey` 없는 기존 행은 지금처럼 id로 바로 삭제).
- **폴더 연결 경우**: `fileSource: 'folder'` + `fileName`(목록 파일 이름)이면 기존 `resolveInvoiceFile`이 그대로 찾는다. blob 저장은 없다. 폴더를 다시 스캔할 때 `knownFileNames()`가 이 파일 이름을 알고 있으므로 다시 처리하지 않는다(이 경우 승인번호 중복 검사까지 갈 필요도 없음).
- **"원본" 버튼**: 목록 엑셀 파일을 기존 `openFileInNewTab`으로 연다(브라우저에 따라 엑셀 파일은 다운로드됨). 몇 번째 줄인지 알 수 있도록 열기 전 짧게 `alert('목록 엑셀의 ' + sourceRow + '번째 줄입니다')`를 띄운다.
- **"재인식" 버튼**: 목록 행은 단건 인식 대상이 아니므로 `retryRecognition`에서 `parseMethod === 'hometax-list'`이면 "홈택스 목록에서 가져온 항목은 재인식 대신 목록 엑셀을 다시 올려주세요(이미 있는 승인번호는 자동으로 건너뜁니다)" 안내 후 종료. 렌더에서 이 행은 재인식 버튼을 숨긴다.
- "텍스트" 버튼은 그대로 `rawText`(그 줄의 원래 엑셀 값)를 보여준다.

### 3.8 중복 방지

- `knownApprovalNos()`: `state.invoices` 중 `approvalNo`가 있는 행들의 정규화 승인번호 집합.
- 목록의 각 계산서가 그 집합에 있으면 건너뛰고 `skipped++`. 같은 업로드 안에서도 3.6-2에서 이미 묶이므로 두 번 들어가지 않는다.
- 결과: "새로 추가 N건, 중복 건너뜀 M건". 중복을 건너뛴 행은 기존 행(공사명·정산서 연결 정보 포함)을 **덮어쓰지 않는다**.
- 단건 PDF/엑셀로 이미 올린 같은 계산서는 승인번호가 없으므로 중복으로 잡히지 않는다. 대신 (발행일·사업자등록번호·공급가액)이 같은 기존 행이 있으면 새 행에 `needsReview=true`를 걸고 결과 영역에 "단건으로 올린 계산서와 겹칠 수 있는 항목 K건(확인 필요 표시)"을 한 줄 덧붙인다(자동 삭제는 하지 않음).

### 3.9 공사명 일괄 지정

- 목록 표 맨 앞에 체크박스 열(`data-select`)을 추가하고, 머리글에 "전체 선택" 체크박스(현재 필터로 보이는 행만 대상)를 둔다. 체크 상태는 메모리(`selectedIds` 객체)에만 두고 저장하지 않는다.
- 표 위 `.bulk-bar`: `[공사명 입력칸(list="project-suggestions")] [선택한 N건에 적용]` + `[같은 거래처 모두 선택]` 버튼.
  - **선택한 N건에 적용**: 선택된 각 행에 기존 셀 수정과 같은 규칙으로 `projectName`을 넣는다 — 값이 바뀌고 `linkedProjectRowId`가 있으면 null로 풀어줌(기존 input 핸들러와 동일 규칙, 공용 함수 `setRowProjectName(row, name)`로 뽑아 셀 수정과 일괄 지정이 함께 씀). `needsReview`/`parseMethod`는 건드리지 않음(기존 규칙: 공사명은 검수와 무관). 적용 후 선택 해제, 저장, 다시 그림.
  - **같은 거래처 모두 선택**: 체크된 행들의 (거래처, 구분) 조합과 같은 다른 행도 모두 체크(사업자등록번호가 있으면 번호로, 없으면 거래처 이름으로 비교). "거래처별 일괄 지정"은 이 버튼 + 적용으로 해결한다.
  - 선택 0건이면 적용 버튼 비활성화, 공사명이 빈칸이면 "공사명을 입력해주세요" 안내.
- 필터 보조: 공사명 필터 옆에 `구분` 필터(전체/매입/매출)와 "공사명 없는 항목만" 체크를 추가해, 새로 들어온 수십 건만 골라 보기 쉽게 한다. 필터 값은 저장하지 않는다. `renderGenerateSummary`는 지금처럼 **공사명 필터만** 기준으로 계산한다(구분 필터와 무관).

### 3.10 구분 열 (목록 표)

- 공급가액 앞(거래처 앞) 위치에 `구분` 열: `<select data-field="direction">` (매입/매출). 기존 input 이벤트 위임에 `change`로도 반응하게 하고(select는 input 이벤트도 발생하지만 안전하게 change도 처리), 값이 바뀌면:
  - `linkedProjectRowId`가 있으면 null로 풀어준다(매입↔매출은 반영 위치가 달라지므로).
  - `needsReview`/`parseMethod`는 바꾸지 않는다(공사명과 같은 취급 — 분류 정보일 뿐 인식값 검수가 아님).
- 목록 행 거래처 칸은 매입이면 공급자, 매출이면 공급받는자라는 뜻이므로, 머리글 `거래처`에 `title="매입=공급자, 매출=공급받는자"` 힌트를 단다. 구분을 바꿔도 거래처 값을 자동으로 바꾸지는 않는다(목록 행은 rawText로 반대쪽 값을 확인 가능).
- **열 번호 주의**: `refreshStatusCell`이 `tr.children[9]`로 상태 칸을 찾고, 빈 목록 `colspan="12"`가 고정이다. 체크박스·구분 2열이 늘면 각각 `children[11]`, `colspan="14"`로 바꿔야 한다. 숫자 하드코딩 대신 상태 칸에 `data-col="status"`를 달고 `tr.querySelector('[data-col="status"]')`로 찾도록 바꾼다.

### 3.11 정산서 생성 연동 (`generateSettlementForProject`)

기존 흐름(신규 생성 / 병합 / 새로 만들기 / 취소, `linkedProjectRowId`로 중복 반영 방지, `paidAmount` 0 시작)을 그대로 두고 매출만 끼워 넣는다.

- `unlinkedInvoices`를 `unlinkedPurchases`(direction ≠ sales)와 `unlinkedSales`(direction = sales)로 나눈다. "새로 반영할 것이 없음" 판정은 두 쪽 모두 0건일 때.
- **매입 행**: 지금과 완전히 같다 — `makeSubcontractRowFromInvoice`로 표1 행 추가, `taxInvoiceIssued=true`, `paidAmount`는 기본값 0, `inv.linkedProjectRowId = row.id`.
- **매출 행**: 표1에 넣지 않고 `targetState.projectInfo.supplyAmount`에 공급가액을 **더한다**. 반영 표시는 같은 필드를 재사용해 `inv.linkedProjectRowId = 'supply'`(문자열 표시값, 기존 코드는 참/거짓으로만 검사하므로 그대로 동작). 정산서의 부가세·합계는 settlement.js가 `calcVat(supplyAmount)`로 다시 계산하므로 계산서의 세액은 넣지 않는다(기존 3.4 규칙과 동일).
  - **create**: `supplyAmount = 0`에서 시작해 매출 공급가액 합계를 넣는다.
  - **merge**: 기존 `supplyAmount`에 이번에 새로 반영할 매출 공급가액 합계를 더한다. 단, 기존 `supplyAmount`가 0보다 크고 이번에 매출 행이 있으면, `promptMergeChoice` 다음에 confirm 한 번: "기존 공급가액 X원에 매출 계산서 Y건(공급가액 Z원)을 더해 W원으로 바꿀까요? 취소하면 공급가액은 그대로 두고 매출 계산서는 반영하지 않습니다." 취소 시 매출 행은 미반영(link 안 함)으로 남고 매입 행 병합만 진행한다(사용자가 계약 공급가액을 직접 입력해 둔 경우 이중 합산 방지).
  - **overwrite**: 새 state이므로 그 공사명의 모든 매출 행 공급가액 합을 넣는다(기존처럼 모든 링크를 풀고 다시 반영).
- 기존 "빈 자리표시 행 정리" 로직·병합 시 기존 표1 행 보존·결제금액 0 시작 규칙은 바꾸지 않는다.
- 결과 문구: `"공사명" 정산서에 매입 계산서 N건(표1 외주·자재비)과 매출 계산서 M건(공급가액 +Z원)을 …했습니다.` 매출 0건이면 지금 문구와 같게.
- **생성 요약 카드**(`renderGenerateSummary`): 기존 건수/공급가액/부가세/합계는 매입 기준으로 바꾸고 라벨을 "매입 공급가액 합계" 등으로, 아래에 `매출 건수`, `매출 공급가액 합계`를 추가한다(`gen-sales-count`, `gen-sales-supply`). 매출이 0건이면 매출 칸은 숨긴다.

### 3.12 셀 수정 시 기존 규칙

- 목록 행도 기존 행과 똑같이 인라인 수정 가능. 금액/거래처 등을 고치면 지금처럼 `needsReview=false`, `parseMethod='manual'`. 이때 `approvalNo`는 유지되므로(화면에 노출 안 함) 중복 방지는 계속 동작한다.

## 4. UI · 안내 문구

### 4.1 사용법 안내(guide-box) — 기존 ①~④ 뒤에 ⑤ 추가

> ⑤ **홈택스 목록 엑셀로 한꺼번에 불러오기**: 홈택스(www.hometax.go.kr) 로그인 → **조회/발급 → 전자세금계산서 → 목록조회 → 매출 목록조회(또는 매입 목록조회)** → 기간을 고르고 조회 → 목록 위 **"엑셀 내려받기"** 버튼으로 받은 파일을 위 업로드 칸에 그대로 올리면, 목록의 계산서 수십 건이 **한 번에 한 줄씩** 들어옵니다. 같은 승인번호는 다시 올려도 자동으로 건너뜁니다. 매입은 표1 외주·자재비로, 매출은 정산서의 공급가액으로 반영됩니다. 체크박스로 여러 건을 골라 공사명을 한 번에 넣을 수 있습니다. (홈택스 로그인·인증서는 이 화면에서 다루지 않으며, 내려받은 엑셀 파일만 이 브라우저 안에서 읽습니다.)

※ 홈택스 메뉴 이름은 개편에 따라 조금씩 다를 수 있으므로 문구 끝에 "(메뉴 이름은 홈택스 화면에 따라 조금 다를 수 있습니다)"를 붙인다.

### 4.2 업로드 카드

- 기존 `folder-hint` 문단에 한 문장 추가: "홈택스 목록조회에서 내려받은 엑셀은 자동으로 알아보고 여러 건을 한 번에 추가합니다."
- 드롭존 아래에 `.hometax-options`: `<label>홈택스 목록 구분 <select id="hometax-direction">자동 판별 / 매출 / 매입</select></label>` + 작은 도움말 "단건 계산서 파일에는 영향이 없습니다".
- `#upload-progress` 아래 `<div id="hometax-result" class="hometax-result" aria-live="polite">`: 가져오기 결과(추가/중복/경고), 매출·매입 선택 버튼(3.5)이 여기 나타난다. 여러 파일을 올리면 파일마다 한 블록씩 쌓이고, "닫기" 버튼으로 지운다.

### 4.3 목록 카드

- 필터 바: 기존 공사명 필터 + `구분` 필터 + "공사명 없는 항목만" 체크.
- 일괄 지정 바(`.bulk-bar`, 필터 바 아래): "선택 N건" 표시, 공사명 입력, 적용, 같은 거래처 모두 선택, 선택 해제.
- 표 열: `☐ | 순번 | 구분 | 발행일 | 거래처 | 공종 | 사업자등록번호 | 공급가액 | 부가세 | 합계 | 공사명 | 상태 | 원본 | 삭제`.
- 구분 표시는 select 자체에 `.dir-sales`/`.dir-purchase` 클래스로 색 테두리(매출=accent, 매입=기본 border). 색은 `var(--color-accent)`, `var(--color-border)` 등 기존 변수만 사용해 다크모드 자동 대응.
- 상태 배지: 목록 행은 문제 없으면 기존 "완료" 대신 "홈택스" 작은 표시(`badge-ok` 재사용 텍스트만 다름), needsReview면 기존 "확인 필요".

### 4.4 모바일

- `.bulk-bar`, `.hometax-options`, 매출/매입 선택 버튼은 ≤640px에서 세로로 쌓고 버튼은 100% 너비, 최소 높이 40px(기존 터치 영역 기준).
- 체크박스 셀은 `min-width:44px`, 체크박스를 label로 감싸 터치 영역 확보. 표는 기존 `.table-scroll` 가로 스크롤 그대로.

## 5. 한계와 대응

- **실제 홈택스 파일로 확인하지 못했다.** 열 이름·순서·헤더 줄 수·병합 방식이 이 문서의 가정과 다를 수 있다. 대응:
  - 열은 이름으로 찾고 공백·줄바꿈 차이는 무시한다(3.3, 3.4).
  - **필수 열을 못 찾으면 화면에 알린다**: 판별 기준(승인번호+공급가액)은 찾았지만 `missingRequired`가 있으면, 결과 영역에 "이 목록에서 다음 열을 찾지 못했습니다: 작성일자, 공급받는자 상호 … — 해당 값은 비어 있으니 직접 입력해주세요" 경고를 띄우고, 행은 추가하되 모두 `needsReview=true`. 승인번호/공급가액이 아예 없으면 목록으로 보지 않고 기존 단건 경로로 넘어간다(그러면 대부분 조용히 무시되므로, 헤더 탐색 중 `승인번호`만 있고 `공급가액`이 없는 행을 봤다면 "홈택스 목록처럼 보이지만 공급가액 열을 찾지 못해 불러오지 못했습니다"를 결과 영역에 표시).
  - 결과 영역에 **찾은 헤더 행 번호와 열 매핑 요약**(예: "헤더: 5행 / 공급자 상호=F열, 공급받는자 상호=K열")을 접힌 `<details>`로 보여줘, 실제 파일을 처음 올렸을 때 잘못 잡힌 열을 사용자가 바로 알 수 있게 한다.
  - 순서로 추정한 경우(3.4-4) 경고 문구를 띄운다.
- 품목이 여러 줄로 나뉘는 방식(계산서 단위 금액 반복 여부)도 가정이다. 첫 줄 금액과 품목 합이 다르면 needsReview로 표시한다.
- 매출/매입 자동 판별은 제목 문구에 의존한다. 판별 실패 시 반드시 사용자에게 묻는다.
- 공종은 품목명 키워드 사전으로만 추정하므로 대부분 직접 입력이 필요하다(기존과 동일).
- 매출을 `projectInfo.supplyAmount`에 더하는 방식은 "매출 계산서 합 = 공사 공급가액"이라는 가정이다. 계약금액을 직접 입력한 정산서와 섞이면 이중 합산될 수 있어 병합 시 확인창을 둔다(3.11). 정산서 화면에서 언제든 직접 고칠 수 있다.
- localStorage 용량: 행마다 `rawText`가 들어가므로 수백 건이면 커진다. 목록 행 `rawText`는 그 줄의 헤더:값만(수백 자) 보관하고 1,000자로 자른다.
- `.xls` 목록은 SheetJS가 읽는 범위 안에서만 동작한다. 홈택스가 내려주는 파일이 실제로는 HTML 표를 `.xls` 확장자로 저장한 형식일 수도 있는데, SheetJS는 HTML 표도 읽으므로 같은 grid 경로로 처리된다(Build 단계에서 샘플로 한 번 확인).

## 6. 테스트용 샘플 엑셀 만드는 방법 (커밋하지 않음)

- 위치: 저장소 밖 임시 폴더(Build 에이전트의 scratchpad 또는 `/tmp`)에서만 만든다. **`apps/settlement/` 안에 샘플 파일이나 생성 스크립트를 두지 않고, 커밋하지 않는다.**
- 방법 A(Node): 임시 폴더에서 `npm install exceljs xlsx` 후 스크립트로 생성.
  - `hometax-sales-sample.xlsx`: 1행 제목 "매출 전자(세금)계산서 목록조회", 2~3행 조회조건("조회기간: 2026-07-01 ~ 2026-07-31" 등), 4행 빈 줄, 5행 헤더(1번 요구사항의 열 전체, 일부 헤더는 일부러 `"공급가액\n"`, `"공급받는자 사업자\n등록번호"`처럼 줄바꿈·공백 포함), 6행부터 데이터 5~6건.
  - `hometax-purchase-sample.xls`(SheetJS `bookType:'xls'`): 제목 "매입 전자(세금)계산서 목록조회", 데이터 5~6건.
  - 데이터 구성: 가짜 상호("가나건설(테스트)", "다라자재(테스트)" 등), 가짜 번호(`000-00-0000x` 형식 — 실제 회사 번호 사용 금지), 가짜 승인번호(`20260715-10000000-00000001` 형식), 금액은 숫자 셀과 콤마 문자열 혼용, 작성일자는 Date 셀과 `"2026-07-15"` 문자열 혼용, 품목명에 "철근 가공", "레미콘(콘크리트)" 등 공종 키워드 포함 1~2건, **같은 승인번호 2줄(품목 2개)** 1건, 마이너스 금액(수정세금계산서) 1건, 합계 불일치 1건.
- 추가로 만들어 볼 변형(경계 확인용): ① 제목에 매출/매입이 없는 파일(선택 버튼이 뜨는지), ② `품목명`/`작성일자` 열을 지운 파일(누락 열 경고), ③ 헤더 위에 "공급자/공급받는자" 병합 묶음 줄이 있고 하위 열이 그냥 `등록번호`/`상호`인 2줄 헤더 파일, ④ 같은 파일 재업로드(중복 건너뜀 N건).
- 방법 B(브라우저): `invoices.html`을 연 상태로 콘솔에서 이미 로드된 `ExcelJS`/`XLSX`로 같은 내용을 만들고 `XLSX.writeFile`/Blob 다운로드로 받아 업로드. 결과 파일은 다운로드 폴더에만 두고 저장소에 넣지 않는다.

## 7. 작업 순서

1. `invoices.js`: `normalizeInvoicesState`에서 기존 행에 `direction:'purchase'`, `approvalNo:''`, `blobKey:null`, `sourceRow:null` 기본값 채우기. `enqueueFile` 행 모양에도 같은 필드 추가. `getDirection` 헬퍼.
2. `invoices.js`: `worksheetToGrid`(ExcelJS)·`xlsSheetToGrid`(SheetJS) 구현 — 병합 칸 처리는 review-v5/v6 규칙 재사용, 빈 칸 자리 유지.
3. `invoices.js`: `normHeader`, `findHometaxHeaderRow`(위 30행, 승인번호+공급가액), 2줄 헤더 그룹 기억.
4. `invoices.js`: `mapHometaxColumns` — 후보 이름 표, 정확 일치 전용 필드(공급가액·세액·비고), 공급자/공급받는자 4단계 구분 규칙, `missingRequired`/`guessed` 결과.
5. `invoices.js`: `detectDirection`(헤더 위 셀 + 시트 이름 + 파일 이름 보조).
6. `invoices.js`: `parseHometaxRows` — 승인번호 정규화, 같은 승인번호 묶기, 날짜·금액·거래처·공종(`extractWorkType` 재사용)·rawText·needsReview 계산.
7. `invoices.js`: `extractExcelInvoiceData`/`extractXlsInvoiceData`에서 워크북 로드 직후 목록 판별을 먼저 시도하고, 아니면 **기존 코드 그대로** 단건 경로. `processOneFile`에 `sourceInfo` 인자 추가, `hometaxList` 결과 분기.
8. `invoices.js`: `importHometaxList` — 임시 행 제거(blob 유지), 중복 검사(`knownApprovalNos`), 단건 겹침 경고, 행 push, 저장·렌더, 결과 영역 표시. 0건이면 blob 삭제.
9. `invoices.js`: 매출/매입 판별 실패 시 `pendingHometaxImports` + 결과 영역 선택 버튼(매출/매입/취소) 처리.
10. `invoices.js`: 원본 참조 — `resolveInvoiceFile`의 `blobKey` 처리, 삭제 시 공유 blob 참조 검사, 원본 버튼 줄 번호 안내, 목록 행 재인식 버튼 숨김·안내.
11. `invoices.html`/`invoices.css`: 업로드 카드 `hometax-direction` select, `#hometax-result` 영역, 안내 문구(4.1, 4.2) 추가.
12. `invoices.html`/`invoices.js`: 목록 표 체크박스 열·구분 열 추가, `refreshStatusCell`을 `data-col="status"` 방식으로, 빈 목록 colspan 14, 구분 select 이벤트(링크 해제 규칙).
13. `invoices.js`: `setRowProjectName` 공용 함수로 셀 수정 로직 정리 → 일괄 지정 바(선택 N건, 적용, 같은 거래처 모두 선택, 선택 해제), 전체 선택(보이는 행만), 구분 필터·"공사명 없는 항목만" 필터.
14. `invoices.js`: `generateSettlementForProject`에 매입/매출 분리, 매출 → `projectInfo.supplyAmount` 합산(create/merge/overwrite 규칙, merge 시 기존 값>0이면 확인창), `linkedProjectRowId='supply'`, 결과 문구. 매입 경로·결제금액 0·빈 행 정리 로직은 변경 없음 확인.
15. `invoices.js`/`invoices.html`: 생성 요약 카드에 매입/매출 분리 표시.
16. `shared-utils.js`: `APP_CHANGELOG` 맨 앞에 v2.2 항목 추가. `invoices.html` 캐시 버스팅(`invoices.js?v=18`, `invoices.css?v=3`, `shared-utils.js?v=11` — index.html·completed.html의 shared-utils 버전도 같이 올릴지는 Build가 판단하되 범위는 `apps/settlement/` 안).
17. 저장소 밖 임시 폴더에서 6절 샘플(매출 .xlsx, 매입 .xls, 변형 ①~④) 생성.
18. Node 단위 확인: 실제 `invoices.js` 함수(판별·매핑·파싱)를 vm으로 불러(review-v5 방식) 샘플로 호출해, 건수·승인번호 묶기·거래처 방향·날짜·금액·누락 열 경고 결과 대조.
19. 브라우저 E2E(로컬 서버): 매출·매입 샘플 업로드 → "새로 추가 N건" 확인 → 같은 파일 재업로드 → "중복 건너뜀 N건" 확인 → 판별 실패 파일에서 선택 버튼 동작 → 체크·같은 거래처 선택·공사명 일괄 적용 → 공사명 필터 → 정산서 생성 → `index.html`에서 열어 표1(매입, 결제금액 0)과 공급가액(매출 합) 확인 → 추가 업로드 후 병합(중복 반영 없음, 공급가액 확인창) 확인 → 새로고침 후 원본 버튼으로 목록 엑셀이 열리는지, 행 하나 삭제 후에도 다른 행 원본이 남는지 확인.
20. 회귀: 단건 PDF/이미지/.xlsx/.xls 업로드(review-v5/v6 항목), 기존 저장 데이터(direction 없는 행)가 매입으로 표시되고 기존 정산서 생성·병합이 전과 같은지, 폴더 연결 재스캔, 다크모드·모바일(360~414px) 화면 확인. 콘솔 에러 없음.
