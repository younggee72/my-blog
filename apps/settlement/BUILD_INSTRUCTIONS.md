# Build 서브에이전트 지침 — 계산서함: 구버전 엑셀(.xls) 파일도 지원

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Build 단계** 서브에이전트다.
`apps/settlement/` 계산서함이 이미 `.xlsx`(최신 엑셀)를 지원하는데, 여기에 **`.xls`(구버전 바이너리 엑셀, Excel 97-2003)도 지원**하도록 확장하는 것이 임무다.

## 배경
계산서함은 이미 PDF/이미지/엑셀(.xlsx만)을 읽어 자동인식한다. `.xlsx` 지원에 쓴 라이브러리는 ExcelJS인데, **ExcelJS는 구버전 바이너리 `.xls` 포맷을 읽지 못한다** — `.xlsx`(OOXML/zip 기반)만 지원한다. 사용자가 실제로 `.xls` 형식 세금계산서 파일도 갖고 있어서, 이걸 읽으려면 다른 라이브러리(SheetJS, npm 패키지명 `xlsx`, 전역 변수 `XLSX`)가 필요하다. `.xls`뿐 아니라 `.xlsx`도 읽을 수 있는 라이브러리이지만, **기존에 이미 잘 동작하고 검증된 `.xlsx`(ExcelJS) 경로는 건드리지 말고 그대로 두고, `.xls`만 새 라이브러리로 처리**하는 것을 권장한다(회귀 위험 최소화).

## 범위 제한 (매우 중요)
- **오직 `apps/settlement/invoices.js`, `apps/settlement/invoices.html` 파일만 수정한다.**
- 다른 파일(`index.html`, `settlement.js`, `shared-utils.js`, `style.css`, `invoices.css`, spec/review 문서들)은 건드리지 않는다.
- 기존 `.xlsx`(ExcelJS) 처리 로직(`extractExcelInvoiceData`, `worksheetToText`, `findInvoiceSheetText`)은 그대로 둔다 — 이미 두 차례 리뷰를 거쳐 검증된 코드다.

## 시작 전 필수: 기존 코드 읽기
`apps/settlement/invoices.js` 전체, 특히 `INVOICE_EXT_RE`, `getExtension`, `processOneFile`, `extractExcelInvoiceData`/`worksheetToText`/`findInvoiceSheetText`(이번에 xls용으로 참고할 기존 xlsx 구조)를 읽어라. `apps/settlement/invoices.html`의 CDN 스크립트 태그 배치, accept 속성, 안내 문구도 확인하라.

## 구현할 것

### 1. 확장자 허용
`INVOICE_EXT_RE`에 `xls`(xlsx와 별개로)를 추가하라. `getExtension(file.name)`이 `'xls'`(정확히 이 값, `'xlsx'`와 구분됨)일 때를 분기 조건으로 쓸 수 있게 하라.

### 2. SheetJS(xlsx) CDN 추가
`invoices.html`에 SheetJS CDN 스크립트 태그를 추가하라(예: `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`, 전역 변수 `XLSX`로 로드됨). 기존 ExcelJS/PDF.js/Tesseract.js 스크립트 태그들과 나란히, `shared-utils.js`/`invoices.js`보다 먼저 로드되도록 배치하라.

### 3. `.xls` 텍스트 추출 함수 추가
`invoices.js`에 `extractXlsInvoiceData(file)` 함수를 새로 추가하라(기존 `extractExcelInvoiceData`와 나란히, 이름은 구분되게):
- `XLSX.read(await file.arrayBuffer(), { type: 'array' })`로 워크북을 읽는다.
- 여러 시트가 있을 수 있으므로, 기존 `.xlsx` 경로의 `findInvoiceSheetText` 방식(모든 시트를 훑어 `isTaxInvoiceDocument()`로 세금계산서로 보이는 첫 시트를 찾고, 없으면 첫 시트로 폴백)과 같은 개념을 SheetJS API에 맞게 구현하라. SheetJS는 `workbook.SheetNames`(시트 이름 배열)와 `workbook.Sheets[name]`(각 시트 객체)로 접근한다.
- 각 시트를 행 단위 텍스트로 변환할 때: SheetJS는 `XLSX.utils.sheet_to_txt(sheet)` 또는 `sheet_to_csv`처럼 바로 텍스트로 뽑는 유틸도 제공하지만, **병합 셀 처리가 기존 xlsx 경로와 다르게 동작하면 라벨이 중복되는 문제(review-v5-excel.md에서 발견됐던 것과 같은 유형의 버그)가 재발할 수 있다** — 반드시 셀을 직접 순회하며 병합 범위(`sheet['!merges']`, 각 원소가 `{s:{r,c}, e:{r,c}}` 형태)의 "왼쪽 위 셀이 아닌" 칸은 건너뛰도록 직접 구현하라(기존 xlsx 경로에서 `cell.isMerged && cell.master !== cell`로 처리한 것과 같은 목적). 셀 값은 `XLSX.utils.encode_cell({r,c})`로 주소를 만들어 `sheet[addr]`로 접근하고, `.v`(원시 값) 또는 `.w`(서식 적용된 표시 문자열)를 쓰되, 날짜 셀은 `YYYY-MM-DD` 형태로 정규화하라(SheetJS 날짜 셀은 보통 `.t === 'd'`이고 `.v`가 Date 객체다 — 이미 기존 `excelCellValueToString` 헬퍼가 이런 정규화를 하고 있으니, 그 함수를 그대로 재사용하거나 같은 원칙으로 SheetJS 셀 값에 맞게 작은 변형을 만들어 재사용하라. 로직을 완전히 새로 중복 작성하지 말고 최대한 공유하라).
- 완성된 텍스트를 기존 `extractFieldsFromText(text)`에 그대로 넘긴다(로직 이중화 금지 원칙 유지 — PDF/이미지/xlsx/xls 네 경로 모두 결국 이 함수 하나로 귀결되어야 한다).
- `isTaxInvoiceDocument(text)`로 세금계산서 형식이 아니면 `{ skip: true }`.
- `parseMethod`는 `'excel'`을 그대로 재사용하라(xlsx와 xls를 사용자에게 굳이 구분해 보여줄 필요는 없다 — 둘 다 "엑셀에서 읽음"이라는 같은 신뢰도 수준으로 취급).
- `result.rawText`에 합쳐진 텍스트를 담아 기존 "텍스트" 진단 버튼에서 확인 가능하게 하라.

### 4. `processOneFile`에 분기 추가
`ext === 'xls'`일 때 `extractXlsInvoiceData(file)`을 호출하도록 추가하라(`ext === 'xlsx'`는 기존 그대로 `extractExcelInvoiceData` 유지). try/catch로 감싸 실패 시 안전하게 `result = null`로 떨어지게 하라(기존 패턴 그대로).

### 5. UI 문구 업데이트
- 업로드 input의 `accept`에 `.xls`와 그 MIME 타입(`application/vnd.ms-excel`)을 추가하라.
- 업로드/폴더연결 안내 문구에 "엑셀(.xls, .xlsx)"처럼 자연스럽게 xls도 언급하도록 손봐라.

## 검증
1. Node.js에 `xlsx`(SheetJS) 패키지를 설치해, 실제 `.xls` 바이너리 형식(SheetJS의 `XLSX.writeFile(wb, 'test.xls', {bookType:'xls'})`로 생성 가능)으로 라벨-값 테스트 파일을 만들어:
   - 발행일/거래처/사업자등록번호/공급가액/세액/합계 모두 정확히 추출되는지.
   - 병합 셀이 있는 경우 라벨이 중복되지 않고 정확한 값이 나오는지(review-v5-excel.md의 병합 셀 버그와 동일한 재현 시나리오를 xls로도 만들어 테스트하라).
   - 여러 시트 중 세금계산서가 첫 시트가 아닌 경우.
   - "거래명세표" 제목의 xls는 조용히 무시되는지.
2. `node --check apps/settlement/invoices.js`로 문법 검증.
3. 브라우저 프리뷰로 `invoices.html`을 열어 콘솔 에러 없이 로드되는지(SheetJS CDN 포함) 확인하고, 실제 `.xls` 파일을 업로드해 엔드투엔드로 값이 정확히 채워지는지 확인하라.
4. 기존 `.xlsx`/PDF/이미지 인식 경로가 이번 수정으로 전혀 영향받지 않았는지 `git diff`로 확인하라(해당 함수들은 한 글자도 안 바뀌어야 한다).
5. `invoices.html`의 캐시 버스팅 쿼리스트링(`invoices.js?v=14` 등)을 하나 올려라.

## 보고
작업이 끝나면 무엇을 만들었는지, 검증 결과를 400자 이내로 요약해서 보고하라.
