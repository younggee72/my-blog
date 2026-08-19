# Build 서브에이전트 지침 — 계산서함: 엑셀(.xlsx) 파일도 계산서로 인식하도록 추가

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Build 단계** 서브에이전트다.
`apps/settlement/` 계산서함(계산서 업로드/폴더연결) 기능이 PDF/이미지뿐 아니라 **엑셀(.xlsx) 파일도 읽어서 자동인식**하도록 확장하는 것이 임무다.

## 배경
지금까지 계산서함은 PDF(PDF.js 텍스트 추출 또는 OCR)와 이미지(Tesseract.js OCR)만 지원했다. 사용자가 세금계산서를 엑셀 파일(.xlsx)로도 갖고 있어서, 이것도 업로드/폴더연결로 읽어 자동인식하고 싶어한다.

## 범위 제한 (매우 중요)
- **오직 `apps/settlement/invoices.js`, `apps/settlement/invoices.html` 파일만 수정한다.**
- 다른 파일(`index.html`, `settlement.js`, `shared-utils.js`, `style.css`, `invoices.css`, spec/review 문서들)은 건드리지 않는다.

## 시작 전 필수: 기존 코드 읽기
`apps/settlement/invoices.js`와 `invoices.html` 전체를 읽어라. 특히:
- `INVOICE_EXT_RE`, `IMAGE_EXT_RE` (허용 확장자 정규식)
- `extractPdfInvoiceData`, `extractImageInvoiceData` (파일 형식별 추출 함수, `processOneFile`에서 확장자로 분기)
- `extractFieldsFromText(text)` — 어떤 경로든 최종적으로 이 함수 하나로 텍스트를 넘겨 필드를 뽑는다는 원칙(spec-v2-invoice.md 3.2)을 그대로 유지해야 한다.
- `invoices.html`의 업로드 input `accept` 속성, 드롭존 안내 문구, 폴더 연결 안내 문구.
- `apps/settlement/index.html`이나 `apps/settlement/settlement.js`가 이미 ExcelJS를 CDN(`exceljs@4.4.0`)으로 쓰고 있는 부분을 참고하라(같은 CDN 버전을 재사용해 일관성을 유지하라). `invoices.html`에는 아직 ExcelJS가 로드되어 있지 않으므로 새로 스크립트 태그를 추가해야 한다.

## 구현할 것

### 1. 확장자 허용 목록에 xlsx 추가
`INVOICE_EXT_RE`(파일 필터링에 쓰이는 정규식)에 `xlsx`를 추가하라. (엑셀 매크로 포함 등 다른 엑셀 확장자까지 넓힐 필요는 없다 — `.xlsx`만 지원하면 된다.)

### 2. 엑셀 텍스트 추출 함수 추가
`extractPdfInvoiceData`/`extractImageInvoiceData`와 나란히 `extractExcelInvoiceData(file)` 함수를 추가하라:
- ExcelJS(`invoices.html`에 CDN으로 추가한 것, `apps/settlement/index.html`이 쓰는 것과 같은 `exceljs@4.4.0` 버전)로 워크북을 읽는다(`workbook.xlsx.load(await file.arrayBuffer())`).
- 첫 번째 워크시트(세금계산서가 보통 1시트로 오므로)의 모든 셀 값을 **행(row) 단위로 순회하며, 같은 행의 셀 값들은 공백으로 이어붙이고, 행이 바뀌면 줄바꿈(`\n`)으로 구분**해서 하나의 텍스트로 합쳐라. 빈 셀은 건너뛴다. 셀 값이 숫자(금액)면 그대로 문자열로 변환하되, 천단위 구분 콤마가 없는 raw 숫자일 수 있으므로 `toLocaleString()`이나 단순 `String()`으로 변환해도 무방하다(기존 `extractAmountNear`의 숫자 추출 정규식 `[\d,]+`이 콤마 없는 숫자에도 매치되는지 확인하고, 안 되면 그 정규식이 콤마 없는 순수 숫자도 인식하도록 손봐도 된다 — 다만 이건 `apps/settlement/invoices.js`의 기존 정규식이라 다른 경로에도 영향을 주니 신중하게 확인하라).
- 이렇게 합쳐진 텍스트를 기존 `extractFieldsFromText(text)`에 그대로 넘긴다(PDF 텍스트 경로와 동일한 함수를 재사용 — 로직 이중화 금지 원칙, spec-v2-invoice.md 3.2).
- 이 문서가 세금계산서 형식인지 판별하는 `isTaxInvoiceDocument(text)`도 그대로 재사용하되, 그 판별에 실패해서 "세금계산서 아님"으로 나오면 다른 형식(PDF/이미지)과 동일하게 조용히 무시(`{ skip: true }`)하도록 처리하라.
- `parseMethod`는 `'excel'`로 새로 추가해 구분하라(다른 값들 `'pdf-text'`/`'ocr'`/`'manual'`/`'failed'`와 나란히). 엑셀에서 뽑은 값은 OCR과 달리 원문 그대로의 텍스트이므로, PDF 텍스트 추출과 동일하게 `needsReview`를 강제로 true 처리하지 않아도 된다(기존 PDF 텍스트 경로와 같은 수준의 신뢰도로 취급).
- `result.rawText`에도 합쳐진 텍스트를 담아, 기존 "텍스트" 진단 버튼(`data-action="rawtext"`)에서 그대로 확인 가능하게 하라.

### 3. `processOneFile`에서 확장자 분기 추가
`getExtension(file.name)`이 `'xlsx'`일 때 `extractExcelInvoiceData(file)`을 호출하도록 분기를 추가하라. PDF/이미지와 마찬가지로 `try/catch`로 감싸 파싱 실패 시 `result = null`(→ 기존 "미인식" 처리 경로)로 안전하게 떨어지게 하라.

### 4. UI 업데이트
- `invoices.html`의 파일 업로드 `<input type="file" accept="...">`에 `.xlsx`(또는 xlsx의 MIME 타입 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)를 추가하라.
- 업로드 카드/드롭존 안내 문구("PDF(전자세금계산서) 또는 스캔본·스크린샷 이미지를...")에 "엑셀(.xlsx)"도 언급하도록 자연스럽게 수정하라.
- 폴더 연결 카드 안내 문구도 마찬가지로 xlsx를 언급하도록 손봐라.
- `handleFileList`(드래그앤드롭/파일선택 처리)와 `scanInvoiceDirHandle`(폴더 스캔)이 xlsx 파일도 걸러내지 않고 받아들이는지 확인하라 — 둘 다 `INVOICE_EXT_RE` 또는 파일 MIME 타입을 기준으로 필터링하므로, 1번에서 정규식만 고치면 자동으로 반영될 가능성이 높지만 직접 코드를 읽고 확인하라.
- ExcelJS CDN 스크립트 태그를 `invoices.html`에 추가하라. 위치는 다른 CDN 스크립트(PDF.js, Tesseract.js)와 나란히, `shared-utils.js`/`invoices.js`보다 먼저 로드되도록 하라.

## 검증
1. Node.js(또는 ExcelJS가 Node에서도 동작하므로 실제로 ExcelJS로 작은 테스트 xlsx 파일을 만들어서) 아래를 확인하라:
   - 발행일/거래처/사업자등록번호/공급가액/세액/합계금액에 해당하는 라벨-값 쌍을 각기 다른 셀에 넣은 간단한 세금계산서 형태의 xlsx를 만들어, `extractExcelInvoiceData` 경로로 값이 정확히 추출되는지.
   - "거래명세표"라는 제목이 든 xlsx는 조용히 무시되는지(1번과 동일 원칙).
2. `node --check apps/settlement/invoices.js`로 문법 검증.
3. 브라우저 프리뷰로 `invoices.html`을 열어 콘솔 에러 없이 로드되는지 확인(ExcelJS CDN 로드 포함).
4. 기존 PDF/이미지 인식 경로가 이번 수정으로 회귀하지 않았는지(코드를 읽고 확인 — PDF/이미지 관련 함수는 건드리지 않았어야 한다).
5. `invoices.html`의 `<script>` 태그에 있는 캐시 버스팅 쿼리스트링(`?v=11` 형태)이 있다면, 이번 수정 이후 버전 번호를 하나 올려라(예: `?v=12`) — 그래야 실사용자 브라우저가 새 코드를 확실히 받는다. `apps/settlement/style.css`/`shared-utils.js` 등 이번에 안 건드린 파일의 버전은 그대로 둬도 된다.

## 보고
작업이 끝나면 무엇을 수정했는지, 검증 결과를 400자 이내로 요약해서 보고하라.
