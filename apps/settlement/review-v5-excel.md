# review-v5-excel.md — 계산서함 엑셀(.xlsx) 인식 기능 독립 검증

## 역할과 방법
이 문서는 REVIEW_INSTRUCTIONS.md 지침에 따라 별도 Review 서브에이전트가 이전 에이전트의
"검증 통과" 자체 보고를 신뢰하지 않고 **직접 재현 테스트**로 xlsx 인식 기능을 검증한 기록이다.

- 단위 테스트: Node.js `vm` 모듈로 `apps/settlement/shared-utils.js` + `apps/settlement/invoices.js`의
  실제 소스(ESM `import` 한 줄만 제거 — pdfjs-dist CDN 로딩용이라 엑셀 로직과 무관)를 그대로 실행해,
  `extractExcelInvoiceData`/`processOneFile` 등 실제 함수 자체를 새로 설계한 테스트 xlsx로 호출했다
  (`npm install exceljs`로 xlsx를 직접 생성). 이전 에이전트의 테스트 파일은 재사용하지 않았다.
- 브라우저 E2E: `http://localhost:8000/apps/settlement/invoices.html`을 열어, 새로 만든 xlsx 파일을
  `<input id="file-input">`에 실제 `File`/`DataTransfer`로 주입하고 `change` 이벤트를 발생시켜
  `handleFileList → enqueueFile → processOneFile → extractExcelInvoiceData`의 프로덕션 경로를
  그대로(네이티브 파일 선택 대화상자만 자동화 도구로 조작 불가능해 대체) 실행했다. CDN에서 로드된
  실제 ExcelJS를 사용했다.

## 검증 항목과 결과

| # | 항목 | 방법 | 결과 |
|---|---|---|---|
| 1 | 라벨/값이 각각 다른 셀에 있는 세금계산서 xlsx 정확 추출 | 단위 테스트(test1) | PASS |
| 2 | 날짜가 실제 Date 타입 셀 → `YYYY-MM-DD` 변환 | 단위 테스트(test1, Date(2026,6,15)) | PASS (2026-07-15) |
| 3 | 금액이 콤마 없는 순수 숫자 셀 | 단위 테스트(test1, 공급가액=1000000) | PASS |
| 4 | 금액이 콤마 포함 문자열 셀 | 단위 테스트(test1, 세액="100,000", 합계="1,100,000") | PASS |
| 5 | 여러 시트 중 세금계산서가 첫 시트가 아닌 경우 | 단위 테스트(test2) | **최초 FAIL → 수정 후 PASS** (아래 "발견/수정" 참고) |
| 6 | "거래명세표" 제목 xlsx 조용히 무시 | 단위 테스트(test3) + 브라우저 E2E | PASS (목록에 행 추가 안 됨, 콘솔 에러 없음) |
| 7 | 완전히 빈 시트 업로드 시 안전하게 "미인식" | 단위 테스트(test3) | PASS (`recognitionFailed:true`, 예외 없음) |
| 8 | 워크시트 0개인 워크북 | 단위 테스트(test3) | PASS (크래시 없음) |
| 9 | 깨진(zip 아님) xlsx 파일 | 단위 테스트(test3) + processOneFile 파이프라인 직접 호출(test4) | PASS — `extractExcelInvoiceData`는 예외를 던지지만 `processOneFile`의 try/catch가 실제로 이를 감싸 `parseMethod:'failed', needsReview:true`로 안전 처리, 크래시 없음을 코드가 아니라 **실행으로** 확인 |
| 10 | 병합 셀 + 빈 행 다수가 있는 xlsx | 단위 테스트(test3) | **최초 FAIL → 수정 후 PASS** (아래 "발견/수정" 참고) |
| 11 | 브라우저 E2E 업로드(정상 xlsx) | 실제 파일 업로드 시뮬레이션 | PASS — 발행일/거래처/사업자등록번호/공급가액/부가세/합계 모두 정확, `parseMethod:'excel'`, `needsReview:false`, 콘솔 에러 없음 |
| 12 | 회귀: PDF/이미지 인식 경로 | `git diff`로 실제 수정 범위 확인 + 코드 재검토 | PASS — `extractFieldsFromText`, `extractPdfInvoiceData`, `extractImageInvoiceData`, `buildTextFromItems`, `isTaxInvoiceDocument` 등은 단 한 줄도 수정되지 않음(diff에 등장하지 않음). 페이지 로드 중 저장돼 있던 기존 PDF 인식 행들도 그대로 정상 표시됨 |
| 13 | 회귀: index.html(정산서 작성 화면) | `git diff --stat` 확인 | PASS — `apps/settlement/index.html`은 이번 변경에 전혀 포함되지 않음(diff 결과 0). index.html은 이미 이전(엑셀 내보내기) 기능 때문에 독자적으로 exceljs CDN을 로드하고 있었고, 이는 이번 변경과 무관 |
| 14 | ExcelJS CDN 추가 스코프가 invoices.html에 한정되는지 | 코드 검토 | PASS — `<script src=".../exceljs...">` 추가는 `invoices.html`에만 있고, `index.html`의 무게/로드에는 변화 없음(애초에 무관하게 존재하던 스크립트) |

## 발견해서 수정한 문제

### 문제 1 — 여러 시트 워크북에서 세금계산서가 첫 시트가 아니면 조용히 유실됨
`extractExcelInvoiceData`가 항상 `workbook.worksheets[0]`만 읽었다. 표지/요약 시트가 앞에 있고
실제 세금계산서 내용이 두 번째 시트에 있는 실사용 가능한 케이스를 재현하는 테스트(test2)에서,
파일이 목록에 추가되지도 못하고(`recognitionFailed:true`) 조용히 사라지는 것을 확인했다.

**수정**: `apps/settlement/invoices.js`에 `worksheetToText(worksheet)`(행→텍스트 변환 공통 로직 분리)와
`findInvoiceSheetText(workbook)`(모든 시트를 순서대로 훑어 `isTaxInvoiceDocument()`로 "세금계산서로
보이는" 첫 시트를 찾고, 없으면 기존과 동일하게 첫 시트로 폴백)를 추가했다. 단일 시트 파일의 기존
동작은 100% 그대로 유지된다(그 경우 폴백이 곧 기존 동작 자체이므로 test1 회귀 없음을 재확인함).

### 문제 2 — 병합 셀이 있으면 라벨이 중복 인식되어 값 추출이 틀어짐
ExcelJS는 병합 범위(예: `A8:B8`) 안의 "주인이 아닌" 칸도 `cell.value`로 주인 칸과 동일한 값을 그대로
돌려준다. 이를 그대로 이어붙이면 `"상호 상호 실제회사명"`처럼 라벨이 중복되고, 텍스트 기반 추출기가
(자간 허용 라벨 매칭 이후 토큰 단위로 값을 찾는 `extractVendor`의 특성상) 두 번째 "상호" 토큰을 값으로
오인해 거래처가 `"병합테스트상사"` 대신 `"상호"`로 잘못 채워지는 것을 test3(mergedCells)로 재현했다.

**수정**: `worksheetToText`의 셀 순회에서 `cell.isMerged && cell.master !== cell`인 칸(병합 범위의
주인이 아닌 칸)을 건너뛰도록 했다. 수정 후 병합 셀 + 빈 행 다수 테스트 모두 정확한 값을 추출한다.

두 수정 모두 `apps/settlement/invoices.js`에만 적용했고, `extractFieldsFromText` 등 PDF/OCR과
공유하는 로직은 손대지 않았다(로직 이중화 금지 원칙 유지). 캐시 버스팅 버전도
`apps/settlement/invoices.html`에서 `invoices.js?v=12` → `?v=13`으로 올렸다.

## 최종 결론
발견된 두 가지 문제(다중 시트 시 세금계산서가 첫 시트에 없는 경우, 병합 셀로 인한 라벨 중복)를
`apps/settlement/invoices.js` 안에서 수정하고, 수정 후 모든 테스트 항목(단위 테스트 1~10, 브라우저
E2E 11, 회귀 12~14)을 재검증해 전부 통과했다. PDF/이미지 인식 경로와 index.html은 이번 변경에
전혀 포함되지 않아(diff 확인) 회귀 위험이 없다. **정상 배포 가능하다고 판단한다.**
