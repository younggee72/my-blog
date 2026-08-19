# Review 서브에이전트 지침 — 계산서함 구버전 엑셀(.xls) 지원 검증

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Review 단계** 서브에이전트다.
`apps/settlement/invoices.js`와 `apps/settlement/invoices.html`에 방금 추가된 ".xls(구버전 엑셀) 지원" 기능을 독립적으로 검증하는 것이 임무다.
너는 이 기능을 만든 에이전트가 아니라 별도로 검증하는 에이전트다. 이전 에이전트의 자체 보고를 그대로 신뢰하지 말고 직접 재현 테스트하라.

## 배경
새로 추가된 것: `INVOICE_EXT_RE`에 `xls`, `extractXlsInvoiceData(file)`(SheetJS/`XLSX.read`로 워크북을 읽고 `buildXlsMergeSkipSet`/`xlsSheetToText`로 병합 셀 처리, `findXlsInvoiceSheetText`로 여러 시트 탐색, 기존 `excelCellValueToString`/`isTaxInvoiceDocument`/`extractFieldsFromText` 재사용), `processOneFile`의 `ext==='xls'` 분기, `invoices.html`의 SheetJS CDN 추가/accept 속성/안내문구, 캐시버전 v=15. 참고로 이전 리뷰(review-v5-excel.md)에서 xlsx(ExcelJS) 경로는 "여러 시트 중 세금계산서가 첫 시트가 아닌 경우"와 "병합 셀로 인한 라벨 중복" 두 가지 버그가 있었다 — 이번 xls(SheetJS) 경로도 같은 종류의 버그가 독립적으로 재발했을 가능성을 특히 의심하고 검증하라.

## 범위 제한
- 검증 대상은 `apps/settlement/invoices.js`, `apps/settlement/invoices.html`.
- 문제를 발견해 수정할 때도 **오직 `apps/settlement/` 폴더 안의 파일만 수정**한다.
- 기존 `.xlsx`(ExcelJS) 처리 로직(`extractExcelInvoiceData`, `worksheetToText`, `findInvoiceSheetText`)과 PDF/이미지 인식 경로는 이번 검증에서 고칠 필요가 없는 한 건드리지 않는다 — `git diff`로 이 함수들이 실제로 안 바뀌었는지 반드시 확인하라.
- `apps/settlement/spec.md`, `spec-v2-invoice.md`, `review*.md`(과거 기록)는 건드리지 않는다.
- 최종 산출물로 `apps/settlement/review-v6-xls.md`를 새로 작성한다.

## 검증 절차
1. `apps/settlement/invoices.js`, `invoices.html`을 처음부터 끝까지 다시 읽고 변경사항을 파악하라.
2. **직접 재현 테스트를 새로 설계해서 실행하라** (이전 에이전트의 테스트 파일을 재사용하지 말 것 — Node에 SheetJS를 설치해 실제 `.xls` 바이너리를 새로 생성하는 방식은 동일해도 된다):
   - 라벨/값이 각각 다른 셀에 있는 세금계산서 형태 .xls를 만들어 정확히 추출되는지.
   - 날짜가 실제 날짜 타입 셀로 들어있는 경우.
   - 병합 셀이 있는 경우(특히 "상호" 라벨처럼 review-v5에서 실패했던 것과 유사한 패턴 — 병합 범위 안에 라벨이 있고 그 옆/아래에 실제 값이 있는 배치) 라벨이 중복되어 값 추출이 틀어지지 않는지, xlsx 경로와 다른 방식(직접 구현한 `buildXlsMergeSkipSet`)이라 별도로 버그가 있을 수 있으니 특히 꼼꼼히 확인하라.
   - 여러 시트 중 세금계산서가 첫 시트가 아닌 경우.
   - "거래명세표" 제목의 .xls가 조용히 무시되는지.
   - 빈 시트, 시트 0개, 깨진(zip도 OLE2도 아닌) .xls 파일을 업로드했을 때 예외 없이 안전하게 "미인식" 처리되는지(`processOneFile`의 try/catch 실제 동작을 실행으로 확인).
   - 금액이 콤마 없는 순수 숫자 vs 콤마 포함 문자열 셀 둘 다.
3. 브라우저 프리뷰로 `invoices.html`을 띄워 실제 .xls 파일 업로드로 엔드투엔드 확인(새로 만든 파일로, 콘솔 에러 없이 정확한 값이 목록에 반영되는지).
4. **회귀 확인**: `git diff`로 `extractExcelInvoiceData`/`worksheetToText`/`findInvoiceSheetText`(.xlsx 경로), PDF/이미지 인식 관련 함수들이 정말 한 글자도 안 바뀌었는지 확인하고, 기존 .xlsx 업로드도 여전히 정상 동작하는지 실제로 한 번 테스트하라.
5. **문제를 발견하면 그 자리에서 `apps/settlement/` 폴더 안의 파일을 직접 수정해 고친다.** 수정 후 다시 2~4번부터 재검증한다.
6. 모든 검증이 끝나면 `apps/settlement/review-v6-xls.md`를 작성한다. 포함할 내용:
   - 검증한 항목과 결과 (통과/실패 여부)
   - 발견해서 수정한 문제 목록 (있다면, 무엇을 어떻게 고쳤는지)
   - 최종 결론: 정상 배포 가능한지 여부
7. 작업이 끝나면 review-v6-xls.md의 핵심 내용을 400자 이내로 요약해서 보고하라.
