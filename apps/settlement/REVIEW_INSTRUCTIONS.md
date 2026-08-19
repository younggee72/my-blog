# Review 서브에이전트 지침 — 계산서함 엑셀(.xlsx) 지원 검증

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Review 단계** 서브에이전트다.
`apps/settlement/invoices.js`와 `apps/settlement/invoices.html`에 방금 추가된 "엑셀(.xlsx) 파일도 계산서로 인식" 기능을 독립적으로 검증하는 것이 임무다.
너는 이 기능을 만든 에이전트가 아니라 별도로 검증하는 에이전트다. 이전 에이전트의 자체 보고("검증 통과")를 그대로 신뢰하지 말고 직접 재현 테스트하라.

## 배경
새로 추가된 것: `INVOICE_EXT_RE`에 xlsx 추가, `extractExcelInvoiceData(file)`(ExcelJS로 워크시트를 행 단위 텍스트로 합쳐 기존 `extractFieldsFromText()`에 그대로 넘김, `excelCellValueToString` 헬퍼로 날짜/리치텍스트/수식결과 셀 정규화), `processOneFile`의 `ext==='xlsx'` 분기, `parseMethod:'excel'`, `invoices.html`의 accept 속성/안내문구/ExcelJS CDN 스크립트 추가, 캐시버전 v=12.

## 범위 제한
- 검증 대상은 `apps/settlement/invoices.js`, `apps/settlement/invoices.html`(그리고 이 둘의 동작에 영향을 주는 `apps/settlement/` 안의 다른 파일들).
- 문제를 발견해 수정할 때도 **오직 `apps/settlement/` 폴더 안의 파일만 수정**한다.
- `apps/settlement/spec.md`, `spec-v2-invoice.md`, `review.md`, `review-v2-invoice.md`, `review-v3-accuracy.md`, `review-v4-label-spacing.md`는 과거 기록이므로 건드리지 않는다.
- 최종 산출물로 `apps/settlement/review-v5-excel.md`를 새로 작성한다.

## 검증 절차
1. `apps/settlement/invoices.js`와 `invoices.html`을 처음부터 끝까지 다시 읽고 변경사항을 파악하라.
2. **직접 재현 테스트를 새로 설계해서 실행하라** (이전 에이전트의 테스트 파일을 재사용하지 말 것 — Node.js에 ExcelJS를 설치해 xlsx를 직접 생성하는 방식은 동일해도 된다):
   - 라벨(작성일자/공급가액/세액/합계금액/상호/사업자등록번호 등)과 값이 각각 다른 셀에 있는 세금계산서 형태 xlsx를 만들어 정확히 추출되는지.
   - 날짜가 엑셀 "날짜" 타입 셀(문자열이 아니라 실제 Date)로 들어있는 경우 `YYYY-MM-DD`로 정확히 변환되는지.
   - 금액이 콤마 없는 순수 숫자 셀(예: 1000000)로 들어있는 경우와, 문자열로 "1,000,000"처럼 들어있는 경우 둘 다 정확히 추출되는지.
   - 여러 시트가 있는 워크북에서 첫 번째 시트만 읽는다는 가정이 실제로 맞는지, 그리고 그 가정이 틀렸을 때(세금계산서 내용이 두 번째 시트에 있는 경우) 어떻게 동작하는지 확인하고 문제라면 개선을 고려하라.
   - "거래명세표" 제목의 xlsx가 조용히 무시되는지.
   - 완전히 빈 시트나 깨진 xlsx 파일을 업로드했을 때 예외가 발생해 전체 파이프라인이 멈추지 않고 안전하게 "미인식" 처리되는지(`processOneFile`의 try/catch가 실제로 이 케이스를 감싸는지 코드로 확인).
   - xlsx 파일에 셀 서식(병합 셀, 빈 행 다수 등)이 있을 때도 합리적으로 텍스트가 재구성되는지.
3. 브라우저 프리뷰로 `apps/settlement/invoices.html`을 띄워, 실제로 xlsx 파일 하나를 업로드해 콘솔 에러 없이 목록에 정확한 값으로 반영되는지 엔드투엔드로 확인하라(이전 에이전트도 이렇게 했다고 보고했지만, 새로 만든 테스트 xlsx로 다시 확인하라).
4. **회귀 확인**: PDF/이미지 인식 경로, 기존 정산서 화면(index.html), 그리고 지난 리뷰들이 확인했던 시나리오들(review-v3/v4)이 이번 변경 이후에도 여전히 정상 동작하는지 `git diff`로 실제 수정 범위를 확인하고 코드를 읽어 재확인하라.
5. `invoices.html`에 ExcelJS CDN이 추가되면서 페이지 로드 시간/무게가 늘어났는데, 이게 계산서함을 쓰지 않는 다른 화면(index.html)에는 영향이 없는지 확인하라(스코프가 invoices.html에만 한정됐는지).
6. **문제를 발견하면 그 자리에서 `apps/settlement/` 폴더 안의 파일을 직접 수정해 고친다.** 수정 후 다시 2~5번부터 재검증한다.
7. 모든 검증이 끝나면 `apps/settlement/review-v5-excel.md`를 작성한다. 포함할 내용:
   - 검증한 항목과 결과 (통과/실패 여부)
   - 발견해서 수정한 문제 목록 (있다면, 무엇을 어떻게 고쳤는지)
   - 최종 결론: 정상 배포 가능한지 여부
8. 작업이 끝나면 review-v5-excel.md의 핵심 내용을 400자 이내로 요약해서 보고하라.
