# Review v2 — 계산서 자동인식 + 공사명별 정산서 자동생성 (검증 보고서)

Build 단계 산출물(`apps/settlement/`에 추가된 계산서함 기능)을 spec-v2-invoice.md와 대조하며 독립적으로 재검증했다. Build 에이전트의 자체 보고는 신뢰하지 않고 코드를 직접 읽고, 정적 서버(`python -m http.server`)로 `index.html`/`invoices.html`을 브라우저에서 실제 조작하며 확인했다.

## 1. spec 대조 결과

7개 파일 구조(`shared-utils.js` 신규, `index.html`/`settlement.js`/`style.css` 수정, `invoices.html`/`invoices.js`/`invoices.css` 신규, `spec.md` 미변경)와 27단계 체크리스트 항목 모두 spec-v2-invoice.md와 일치하게 구현되어 있음을 확인했다. `settlement-invoices-state`, `settlement-app-saved-projects` 저장 구조, `extractFieldsFromText()` 휴리스틱(사업자등록번호 공급자/공급받는자 구간 탐색, 라벨 기반 금액 추출, needsReview 판정 로직), `generateSettlementForProject()`의 create/merge/overwrite 3분기 로직, `linkedProjectRowId` 중복 방지까지 spec 3.1~3.4 설계대로 구현됨.

## 2. Build 에이전트가 보고한 3가지 계획 이탈 사항 검토

- **mirror-save 위치를 onStateChange 대신 saveToLocalStorage로 이동**: 타당함. `bindSimpleInputs()`의 공사명 입력 핸들러 등 여러 경로가 `onStateChange()`를 거치지 않고 `saveToLocalStorage()`만 직접 호출하므로, spec대로 `onStateChange()`에만 붙였다면 공사명을 입력해도 저장소에 미러링되지 않는 누락이 생겼을 것. `saveToLocalStorage()`가 유일한 저장 지점이므로 여기 붙인 것이 맞다.
- **3-way 다이얼로그를 confirm() 2회 체이닝으로 구현**: 타당함. 네이티브 `confirm()`은 2지선다만 가능하므로 병합(1차 확인, 기본 권장) → 새로 만들기(2차 강한 경고) → 취소 순으로 체이닝한 것이 안전하며, 실제 브라우저 테스트에서 취소 시 아무 것도 바뀌지 않고 병합 승인 시에만 정확히 반영되는 것을 확인했다(4절 참고).
- **Tesseract.js 언어 인자를 배열 형태로 사용**: 타당함. spec은 구버전 API(`recognize(image, 'kor+eng')`)를 가정했지만, CDN에서 로드한 Tesseract.js v5는 `createWorker(['kor','eng'])`로 언어를 지정하고 `worker.recognize(image)`는 인자를 받지 않는 것이 올바른 v5 API다. 실제로 CDN 로드 후 `Tesseract.createWorker`가 정상 동작함을 확인했다.

## 3. 회귀 검증 — 기존 정산서 화면(index.html 단독 사용)

계산서함을 전혀 쓰지 않는 시나리오로 실제 조작 확인:
- 공사명/공급가액 입력 → 부가세·합계 자동 계산 정상.
- 외주·자재비 행에 거래처/공급가액 입력 → 부가세·합계·소계 실시간 갱신 정상.
- 새로고침 후 입력값 그대로 복원됨(`settlement-app-state` 정상 저장/로드).
- **결제금액은 0에서 시작**하고 **잔액 = 합계 − 결제금액**으로 정확히 계산됨(신규 행 기본값 확인).
- "엑셀로 내보내기" 클릭 시 콘솔 에러 없이 ExcelJS 정상 로드·동작(다운로드 트리거까지 확인, 실제 파일 저장은 브라우저 정책상 자동화 환경에서 직접 열어보지 않았으나 예외 없이 완주됨).
- "데이터 폴더 연결" 카드가 그대로 남아있고 버튼/문구 모두 정상.
- 공사명을 입력하면 `settlement-app-saved-projects`에도 자동 미러 저장됨(신규 기능이지만 기존 UI/동작에는 영향 없음).

**결론: 기존 화면 회귀 없음.**

## 4. 신규 기능 — invoices.html 실동작 검증

- 페이지 로드 시 콘솔 에러 없음(PDF.js/Tesseract.js CDN 정상 로드, `type="module"` 스크립트와 `shared-utils.js`의 로드 순서 문제 없음).
- 테스트용 세금계산서 PDF(발행일/공급자·공급받는자 사업자등록번호/상호/품목/금액 3종 포함)를 직접 만들어 업로드 → 목록에 "인식 중…" 배지로 즉시 추가된 후, 자동인식 결과가 정확히 채워짐을 확인:
  - 발행일 `2026-03-15`, 거래처 `테스트건설`, 공종 `철근`(키워드 사전 매칭), 사업자등록번호 `123-45-67890`(공급자 블록만 정확히 채택, 공급받는자 번호 `999-88-77777`은 무시됨), 공급가액/부가세/합계 각각 `5,000,000`/`500,000`/`5,500,000`.
  - 금액 3종이 정합하고 필수 필드가 모두 채워져 `needsReview=false`, `parseMethod='pdf-text'`, 상태 배지 "완료"로 정상 표시.
- 공사명 필터가 정상 동작(옵션 자동 생성, 선택 시 목록 필터링·요약 카드 표시).
- "이 공사명으로 정산서 생성" 클릭 시 confirm() 취소 → 아무 것도 바뀌지 않음(안전 확인), confirm() 승인(병합) → 기존 저장된 정산서(다른 공급업체 1행)는 그대로 유지된 채 새 계산서 1건만 외주·자재비 행으로 추가됨, `linkedProjectRowId`가 정확히 기록되어 재생성 시 중복 반영되지 않음.
- index.html에서 해당 정산서를 열어보면 자동 생성된 행에 공종/발행일/거래처/사업자등록번호/공급가액이 정확히 반영되어 있고, **결제금액은 0, 잔액은 합계 전체**로 시작함을 확인(전자세금계산서 체크박스도 자동으로 체크됨).
- 모바일 375px/320px 뷰포트에서 업로드 드롭존·"파일 선택" 버튼·폴더 연결 버튼·필터 드롭다운·목록 표(가로 스크롤)·배지 모두 레이아웃 깨짐 없이 정상 표시.
- 다크모드 토글이 index.html/invoices.html 양쪽에서 같은 `settlement-app-theme` 키를 공유하며 정상 전환됨. "확인 필요" 배지(`--settlement-warning` 변수)가 라이트/다크 모드 모두에서 판독 가능한 색 대비로 표시됨을 확인.
- 사용법 안내 문구가 index.html/invoices.html 양쪽 guide-box에 모두 존재.

## 5. 발견해서 수정한 문제

### 5-1. (버그) PDF.js가 CMap 리소스 없이 로드되어 일부 PDF의 텍스트 추출이 실패
`extractPdfInvoiceData()`에서 `pdfjsLib.getDocument({ data: arrayBuffer })`만 호출하고 `cMapUrl`/`cMapPacked`를 지정하지 않아, Adobe 표준 CJK 폰트(비임베드 CID 폰트)를 쓰는 PDF에서 텍스트를 전혀 추출하지 못하고 불필요하게 OCR로 폴백해 모든 필드가 빈 값으로 남는 문제를 리뷰 중 직접 만든 테스트 PDF로 재현했다. `invoices.js`에 `PDFJS_CMAP_URL`(pdfjs-dist CDN의 `cmaps/` 경로)을 추가하고 `getDocument()` 호출에 `cMapUrl`/`cMapPacked: true`를 넘기도록 수정했다. 수정 후 동일 테스트 PDF에서 모든 필드(발행일/거래처/공종/사업자등록번호/금액 3종)가 정확히 추출되고 `needsReview=false`, `parseMethod='pdf-text'`로 정상 판정됨을 확인했다. 실제 홈택스 등에서 발급된, 폰트를 완전히 임베드한 일반적인 전자세금계산서 PDF에는 원래도 영향이 없던 범위지만, 이 수정으로 비임베드 CID 폰트를 쓰는 PDF까지 안전하게 커버한다.

### 5-2. (버그) 같은 공사명을 다시 선택해도 저장된 정산서가 갱신되지 않음
`settlement.js`의 `bindProjectPicker()`가 `if (!chosen || chosen === state.projectInfo.name) return;`으로 되어 있어, 계산서함(invoices.html)에서 "이 공사명으로 정산서 생성"(병합)을 실행해 `settlement-app-saved-projects`의 내용이 갱신되어도, index.html에서 **마침 그 공사명이 이미 화면에 열려 있는 상태**라면 드롭다운에서 같은 이름을 다시 선택해도 조건문이 즉시 반환되어 아무 것도 불러오지 않는 문제를 발견했다. 실제로 "테스트공사"를 index.html에서 입력해두고(1개 행), 같은 이름으로 invoices.html에서 계산서를 병합(2개 행이 됨)한 뒤 index.html로 돌아가 드롭다운에서 "테스트공사"를 다시 선택해도 화면에는 여전히 1개 행만 보이는 것을 재현했다. 사용자가 새로고침을 하지 않는 한 방금 반영한 계산서 내역을 확인할 방법이 없는 실질적인 버그다.

`chosen === state.projectInfo.name`일 때 "다른 정산서로 벗어나는지" 확인하는 `confirm()`은 건너뛰되(같은 이름이므로 이탈 경고가 필요 없음), 저장소에서 항상 최신 데이터를 다시 불러오도록 수정했다:

```js
if (chosen !== state.projectInfo.name && state.projectInfo.name) {
  var ok = confirm(...);
  if (!ok) return;
}
// 이름이 같아도 항상 저장소에서 다시 불러온다.
```

수정 후 동일 시나리오를 재현해 드롭다운에서 "테스트공사"를 다시 선택하면 즉시 2개 행(외주·자재비 소계 6,000,000/600,000/6,600,000)으로 갱신되고, 새로 반영된 행도 결제금액 0/잔액 전액으로 정상 시작함을 확인했다.

두 수정 모두 `apps/settlement/invoices.js`, `apps/settlement/settlement.js` 안에서만 이루어졌으며, 수정 후 3~6번 검증 항목(spec 대조, 회귀 테스트, 웹앱 공통 규칙, 브라우저 실동작)을 다시 통과함을 확인했다.

## 6. 코드 점검 — 그 외 특이사항(수정하지 않음, 참고용)

- `resolveInvoiceFile()`은 `fileSource: 'folder'`인 계산서의 폴더 권한이 만료된 경우 `null`을 반환하고, 호출부(`viewOriginal`)가 이를 받아 `fileSource`를 `'missing'`으로 표시하며 인식된 값은 그대로 보존한다 — spec 6절 "폴더/파일 참조 유실" 요구사항대로 구현되어 있음을 코드로 확인.
- OCR 경로(`extractImageInvoiceData`, 스캔 PDF 폴백)는 결과와 무관하게 `needsReview`를 항상 `true`로 강제하는 것을 코드로 확인(spec 3.2 요구사항).
- 공사명 필드를 수정해도 `needsReview`/`parseMethod`에 영향을 주지 않도록 예외 처리되어 있음(spec 4절 "공사명은 애초에 자동인식 대상이 아니므로" 요구사항과 일치).
- 세 금액(공급가액/부가세/합계)은 계산서함 목록에서는 서로 독립적으로 직접 수정 가능한 입력칸이며(실제 계산서의 반올림 방식이 앱의 10% 계산과 다를 수 있으므로), 정산서로 반영될 때는 공급가액만 가져가고 부가세/합계는 항상 정산서 쪽 규칙(`calcVat`/`calcTotal`)으로 재계산된다 — spec 3.4 요구사항과 정확히 일치.

## 7. 최종 결론

spec-v2-invoice.md의 설계와 27단계 체크리스트를 모두 만족하며, 발견된 2건의 버그(PDF.js CMap 미지정으로 인한 텍스트 추출 실패, 같은 공사명 재선택 시 저장소 미갱신)를 `apps/settlement/invoices.js`와 `apps/settlement/settlement.js` 안에서 수정하고 재검증까지 마쳤다. **기존 정산서 화면(index.html 단독 사용) 회귀는 없음을 명확히 확인**했으며(입력/저장/새로고침 복원/엑셀 내보내기/폴더 연결/결제금액·잔액 로직 모두 이전과 동일하게 동작), 신규 계산서함 기능도 업로드→자동인식→검수→공사명별 정산서 생성까지 전체 플로우가 정상 동작한다. 사이트 팔레트 변수 사용, 다크모드, 모바일 레이아웃, 사용법 안내 문구 등 웹앱 공통 규칙도 모두 충족한다. **정상 배포 가능.**
