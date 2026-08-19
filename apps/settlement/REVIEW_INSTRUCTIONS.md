# Review 서브에이전트 지침 — 계산서함 라벨 자간(공백) 대응 수정 검증

## 역할
너는 이 프로젝트(마크다운 블로그 + 미니 웹앱 포트폴리오)의 **Review 단계** 서브에이전트다.
`apps/settlement/invoices.js`에 방금 적용된 수정(라벨 글자 사이 자간 공백에 관대한 탐색으로 전환)을 독립적으로 검증하는 것이 임무다.
너는 이 수정을 만든 에이전트가 아니라 별도로 검증하는 에이전트다. 이전 에이전트의 "17/17 단위 테스트 통과" 자체 보고를 그대로 신뢰하지 말고 코드를 직접 읽고 새로 재현 테스트하라.

## 배경
실사용자가 실제 세금계산서 PDF를 업로드했을 때, 사업자등록번호는 정확히 나오는데 공급가액/세액/합계금액이 전부 0으로 나오는 문제가 있었다. 원인으로 "라벨(공급가액 등) 글자 사이에 자간용 공백이 있어 `text.indexOf(라벨)` 통짜 검색이 실패한다"는 가설을 세우고, `buildLooseLabelSource`/`buildLooseLabelRegex`/`findLooseLabel` 헬퍼를 추가해 `sliceBetween`/`extractVendor`/`extractIssueDate`/`extractAmountNear`(+`amountAtColumnIndex`용 `tokenizeWithOffsets`)/`isTaxInvoiceDocument`를 전부 이 방식으로 교체했다. 글자 사이 공백 허용치는 `LABEL_GAP_MAX = 4`.

## 범위 제한
- 검증 대상은 `apps/settlement/invoices.js`.
- 문제를 발견해 수정할 때도 **오직 `apps/settlement/` 폴더 안의 파일만 수정**한다.
- `apps/settlement/spec.md`, `spec-v2-invoice.md`, `review.md`, `review-v2-invoice.md`, `review-v3-accuracy.md`는 과거 기록이므로 건드리지 않는다.
- 최종 산출물로 `apps/settlement/review-v4-label-spacing.md`를 새로 작성한다.

## 검증 절차
1. `apps/settlement/invoices.js`를 처음부터 끝까지 읽고 변경사항을 파악하라. 특히 `LABEL_GAP_MAX`를 4로 정한 근거가 타당한지(너무 관대해서 오탐이 나거나, 너무 엄격해서 실제 자간을 못 잡는 경우는 없는지) 판단하라.
2. **직접 재현 테스트를 새로 설계해서 실행하라** (이전 에이전트의 테스트를 재사용하지 말 것):
   - 글자 사이 공백이 1~4칸씩 다양하게 섞인 라벨("공급가액", "세액", "부가세", "합계금액", "상호", "작성일자", "공급자", "공급받는자", "세금계산서") 각각에 대해 정상 추출되는지.
   - 자간이 아예 없는(붙어있는) 기존 케이스도 여전히 정상 추출되는지(회귀 없음).
   - **오탐 위험 시나리오**: 문서 안에 라벨과 무관하게 한 글자씩 띄엄띄엄 흩어진 텍스트가 있을 때(예: 다른 문장의 일부가 우연히 "공...급...가...액" 비슷하게 늘어서 있는 경우) 잘못 매치되지 않는지 — 특히 `LABEL_GAP_MAX=4`가 실제로 이런 오탐을 막기에 충분한지 극단적인 케이스로 시험하라(예: 라벨 글자들이 정말 무관한 긴 텍스트 사이에 각각 4칸 이하 간격으로 우연히 나열된 경우).
   - `extractAmountNear`의 표 컬럼 매칭(`amountAtColumnIndex`, `tokenizeWithOffsets`)이 자간 섞인 헤더 라벨과 함께 있을 때도 정상 동작하는지.
   - `isTaxInvoiceDocument`가 자간 섞인 "거래명세표"/"거래  명세표"도 여전히 정확히 걸러내는지, 자간 섞인 "세금계산서"도 정확히 인정하는지.
   - 이전 리뷰(review-v3-accuracy.md)가 확인했던 6개 시나리오(정상 계산서/표 레이아웃/거래명세표/저품질/날짜함정/상호 분리)도 이번 수정 이후에도 여전히 통과하는지 다시 실행하라(6절 표 참고).
3. 브라우저 프리뷰로 `apps/settlement/invoices.html`을 띄워 콘솔 에러 없이 로드되는지 확인한다.
4. `git diff apps/settlement/invoices.js`로 실제 변경 내용을 검토하고, 의도치 않은 부작용(예: 무한루프 가능성, 성능 문제 — 정규식을 매 호출마다 새로 컴파일하는 것이 큰 텍스트에서 느리지 않은지)이 없는지 점검한다.
5. **문제를 발견하면 그 자리에서 `apps/settlement/` 폴더 안의 파일을 직접 수정해 고친다.** 수정 후 다시 2~4번부터 재검증한다.
6. 모든 검증이 끝나면 `apps/settlement/review-v4-label-spacing.md`를 작성한다. 포함할 내용:
   - 검증한 항목과 결과 (통과/실패 여부)
   - 발견해서 수정한 문제 목록 (있다면, 무엇을 어떻게 고쳤는지)
   - 최종 결론: 정상 배포 가능한지 여부
7. 작업이 끝나면 review-v4-label-spacing.md의 핵심 내용을 400자 이내로 요약해서 보고하라.
