# 현장정산서 v2 — 계산서 자동인식 + 공사명별 자동생성 구현 계획 (spec-v2-invoice.md)

이 문서는 이미 존재하는 `apps/settlement/`(현장정산서 자동화 도구)에 "계산서 업로드/자동인식/목록관리"와 "공사명별 정산서 자동 생성" 기능을 추가하는 계획이다. **코드는 작성하지 않는다.** 기존 `index.html` / `settlement.js` / `style.css` / `spec.md`를 모두 읽고 그 구조(상태 모델, localStorage 키, 렌더링·이벤트 위임 패턴, File System Access API 폴더 연결, ExcelJS 내보내기)를 그대로 연장하는 방향으로 설계했다.

## 1. 개요

현재 `apps/settlement/`는 "정산서 1건을 화면에서 채워 넣는 계산기"다. 이번 확장은 그 앞단에 **"계산서(세금계산서) 저장소"** 개념을 추가한다. 사용자는 여러 현장의 세금계산서(PDF·스캔본·스크린샷)를 계산서함에 업로드하면, PDF.js(임베드 텍스트 추출)와 Tesseract.js(OCR)를 이용해 발행일·거래처·사업자등록번호·공급가액·부가세·합계를 자동으로 뽑아 목록 테이블 한 줄로 만든다. 공사명만은 계산서 자체에 없는 정보이므로 항상 사용자가 직접 붙인다. 공사명으로 필터링해 같은 현장의 계산서를 모아본 뒤, "이 공사명으로 정산서 생성" 버튼을 누르면 기존 정산서 화면(1단계 표1 "외주·자재비")에 해당 계산서들이 협력업체 행으로 자동 채워진 정산서가 만들어진다.

기존 화면은 "정산서 1건만" 다루던 단일 상태(`settlement-app-state`) 구조였는데, 계산서함에서는 여러 공사명의 정산서를 동시에 생성/보관해야 하므로 **"저장된 정산서 여러 건을 이름으로 관리하는 저장소"** 개념을 새로 추가하고, 기존 단일 활성 상태는 "지금 화면에 열려 있는 정산서(작업 사본)"로 재정의한다. 이 저장소를 매개로 계산서함(신규 화면)과 정산서 화면(기존 화면)이 연동된다. 기존 화면의 단독 사용(정산서 1건만 수기로 채워서 바로 엑셀로 내보내는 기존 워크플로우)은 전혀 깨지지 않는다 — 계산서함을 한 번도 쓰지 않으면 이전과 동일하게 동작한다.

## 2. 파일 구조

```
/apps/settlement/
  index.html          (수정) 정산서 작성 화면. 상단에 탭 네비게이션 추가, 공사 기본 정보 카드에
                       "저장된 정산서 불러오기" 드롭다운 추가. shared-utils.js 스크립트 태그 추가.
  settlement.js        (수정) 공통 유틸 함수(반올림/포맷/사업자번호 등)를 shared-utils.js로 이관.
                       onStateChange 시 공사명 기준으로 "저장된 정산서 저장소"에도 미러 저장하는
                       로직과, 저장소 목록을 읽어 드롭다운을 채우고 선택 시 불러오는 로직 추가.
  style.css            (수정) 탭 네비게이션 바, 정산서 선택 드롭다운 스타일 추가(기존 팔레트 변수 재사용).
  spec.md               (변경 없음) 1단계 기존 설계 문서, 그대로 보존.

  shared-utils.js      (신규) 두 화면이 공통으로 쓰는 순수 유틸 함수 모음.
                       round/calcVat/calcTotal/parseNumber/formatNumber/formatBizRegNo/escapeAttr/
                       sanitizeFilenamePart + 다크모드 토글(getPreferredTheme/applyTheme/toggleTheme)
                       + "저장된 정산서 저장소" 읽기/쓰기 헬퍼(loadSavedProjects/saveProjectByName 등).
                       전역 오염을 피하기 위해 `window.SettlementShared = {...}` 네임스페이스 하나만 노출.
                       index.html·invoices.html 둘 다 이 파일을 settlement.js/invoices.js보다 먼저 로드.

  invoices.html        (신규) 계산서함 화면. 업로드/폴더연결 영역, 자동인식 목록 테이블(필터 포함),
                       "공사명으로 정산서 생성" 액션. 상단 탭 네비게이션(index.html과 동일)을 공유.
  invoices.js          (신규) 계산서 상태 관리, 폴더 연결(자체 IndexedDB), PDF.js/Tesseract.js
                       파싱 파이프라인, 목록 렌더/필터/셀 수정, 정산서 생성·병합 로직.
  invoices.css          (신규) invoices.html 전용 스타일(업로드 드롭존, 배지, 필터 드롭다운, 상태 아이콘).
                       공통 카드/표/버튼 스타일은 기존 style.css를 그대로 재사용하기 위해
                       invoices.html이 style.css도 함께 로드한다.
```

기존 파일 중 `spec.md`는 1단계 기록이므로 건드리지 않는다. `shared-utils.js` 추출은 기존 파일 수정 범위가 넓어 보일 수 있지만, calcVat 반올림 방식 등 계산 규칙이 두 화면(정산서 화면·계산서함)에서 어긋나면 자동 생성된 정산서 금액이 화면마다 다르게 보이는 치명적 버그로 이어지므로, 계산 로직은 반드시 한 곳에만 존재해야 한다는 판단이다.

## 3. 핵심 로직 설계

### 3.1 계산서 데이터 상태 구조

localStorage 키 `settlement-invoices-state` 하나에 아래 구조로 저장한다(기존 `settlement-app-state`와 동일하게 매 변경마다 통째로 저장).

```js
invoicesState = {
  invoices: [
    {
      id: 1,                     // nextId 카운터로 발급, 삭제해도 재사용 안 함
      fileName: "20260301_삼성전자_세금계산서.pdf",
      fileSource: "folder" | "blob" | "missing",
      // folder: 연결된 폴더에서 매번 다시 읽음(파일 자체는 저장 안 함)
      // blob: FS Access API 미지원 브라우저 fallback — IndexedDB에 파일 바이트를 별도 저장
      // missing: 파일 참조를 잃어버림(폴더 연결 해제·파일 이동 등) — "원본 다시 연결" 유도

      issueDate: "",              // 발행일 (yyyy-mm-dd)
      vendor: "",                 // 거래처(공급자 상호)
      workType: "",               // 공종 (추정 실패 시 빈 값)
      bizRegNo: "",                // 공급자 사업자등록번호
      supplyAmount: 0,
      vat: 0,
      total: 0,
      projectName: "",             // 공사명 — 자동인식 대상 아님, 사용자가 직접 입력/선택

      parseMethod: "pdf-text" | "ocr" | "manual" | "failed",
      needsReview: true,           // "확인 필요" 배지 표시 여부(아래 3.2 참고)
      linkedProjectRowId: null     // 이미 어떤 정산서(subcontract 행)로 반영됐는지(중복 반영 방지, 3.4 참고)
    }
  ],
  invoicesNextId: 2
}
```

원본 파일 바이트는 localStorage(용량 제한)에 넣지 않는다. `fileSource: "blob"`인 항목은 별도 IndexedDB(`settlement-invoices-db`, 오브젝트스토어 `files`, key=invoice id)에 File을 그대로 저장한다. `fileSource: "folder"` 항목은 연결된 디렉터리 핸들에서 파일명으로 다시 찾아 읽는다. 두 경우 모두 "원본 보기" 버튼에서 `URL.createObjectURL(file)`로 새 탭에 연다.

정산서 쪽 확장: 기존 `settlement-app-state`(현재 화면에 열려 있는 정산서 1건, 작업 사본) 외에 새 키 `settlement-app-saved-projects`를 추가한다 — `{ [공사명]: 정산서state } ` 형태의 딕셔너리로, 여러 공사명의 정산서를 동시에 보관한다. `settlement.js`의 기존 `onStateChange()`에 아래 한 단계만 덧붙인다: `projectInfo.name`이 비어있지 않으면 현재 `state`를 `savedProjects[projectInfo.name]`에도 그대로 미러 저장(shared-utils.js의 `saveProjectByName` 헬퍼). 이렇게 하면 사용자가 index.html에서 손으로 채우는 기존 워크플로우도 자동으로 "이름 붙은 정산서 저장소"에 쌓이고, 계산서함에서 자동 생성한 정산서도 같은 저장소를 공유한다. index.html에는 공사 기본 정보 카드 옆에 `<select id="project-picker">`를 추가해 저장소에 있는 공사명 목록을 보여주고, 선택하면 "현재 화면 내용을 저장하지 않고 불러올까요?"(현재 활성 state와 다른 공사명일 때만) 확인 후 `savedProjects[선택한 이름]`을 `settlement-app-state`에 복사하고 `renderAll()`을 다시 호출한다.

### 3.2 PDF.js / Tesseract.js 자동 인식 파이프라인

공통 함수 `extractFieldsFromText(text)`를 만들어 PDF 텍스트 경로와 OCR 경로가 모두 이 함수 하나를 거치게 한다(추출 로직 이중화 방지).

**처리 순서 (파일 1건당)**

1. 확장자 판별. `.pdf` → 2번, 이미지(`.jpg/.jpeg/.png/.webp/.heic` 등) → 4번.
2. **PDF 텍스트 추출**: `pdfjs-dist`(CDN `pdfjs-dist@4.x`, `pdf.min.mjs` + 워커 `pdf.worker.min.mjs`)로 문서를 열고 1페이지(세금계산서는 보통 1페이지)의 `getTextContent()`로 텍스트 아이템을 모아 하나의 문자열로 합친다(아이템의 y좌표로 줄바꿈을 재구성해 "공급가액 1,000,000" 같은 라벨-값 쌍이 최대한 붙어 있도록 정렬).
3. 합친 텍스트 길이가 임계값(예: 20자) 미만이면 "임베드 텍스트가 없는 스캔 PDF"로 간주 → pdf.js로 해당 페이지를 캔버스에 렌더링(`page.render()`)한 뒤 그 캔버스를 4번(OCR)에 그대로 넘긴다. 텍스트가 충분하면 그 문자열을 `extractFieldsFromText()`에 전달하고 `parseMethod: "pdf-text"`.
4. **OCR**: Tesseract.js(CDN `tesseract.js@5`)로 이미지/캔버스를 `kor+eng` 언어팩으로 인식(`recognize(image, 'kor+eng')`). 한글 세금계산서 인식은 폰트·스캔 품질에 따라 정확도가 크게 떨어질 수 있음을 안내 문구에 명시. 결과 텍스트를 동일한 `extractFieldsFromText()`에 전달하고 `parseMethod: "ocr"`, `needsReview`는 필드 완성도와 무관하게 항상 `true`로 강제.
5. Tesseract 워커는 파일이 실제로 있을 때만 지연 생성(첫 이미지/스캔PDF 처리 시점에 1회 초기화)하고, 언어 데이터(`kor.traineddata`, 수 MB)를 그때 CDN에서 내려받는다는 점을 안내 문구와 "인식 중..." 상태 표시로 알린다.
6. 여러 파일을 한 번에 올렸을 때는 순차 큐로 하나씩 처리(Tesseract 워커 동시 실행 시 리소스 경합 방지). 처리 중인 행은 목록에 즉시 추가하되 "인식 중…" 임시 배지를 달아두고(이 상태는 저장하지 않음 — 새로고침 시 처리 중이던 행은 "미인식"으로 남아 재시도 버튼 노출), 완료되면 값과 `needsReview`를 채워 갱신한다.

**`extractFieldsFromText(text)` 내부 휴리스틱**

- 사업자등록번호: 정규식 `/\d{3}-\d{2}-\d{5}/g`로 전체 매치를 모두 찾는다. 표준 양식은 "공급자"와 "공급받는자" 두 블록에 각각 하나씩 나오므로, 텍스트에서 "공급자"라는 라벨이 나온 위치 이후 ~ "공급받는자"라는 라벨이 나오기 전 구간에서 처음 매치된 번호를 거래처(공급자) 사업자등록번호로 채택한다(라벨을 못 찾으면 첫 번째 매치를 사용하고 `needsReview=true`).
- 상호(거래처명): "공급자" 블록 내에서 "상호" 또는 "상호(법인명)" 라벨 뒤에 오는 첫 텍스트 토큰.
- 발행일(작성일자): `/(\d{4})[.\-년]\s?(\d{1,2})[.\-월]\s?(\d{1,2})일?/` 매치 → `yyyy-mm-dd`로 정규화.
- 공급가액 / 세액(부가세) / 합계금액: "공급가액", "세액"(또는 "부가세"), "합계금액"(또는 "청구금액") 라벨 각각의 뒤쪽 가장 가까운 숫자·콤마 패턴 `/[\d,]+/`을 값으로 채택 → `parseNumber()`(shared-utils)로 정수화. 세 값이 서로 정합하지 않으면(공급가액+세액≠합계) 셋 다 `needsReview=true` 처리해 사용자가 직접 확인하도록 한다.
- 공종: 계산서에 명시적 필드가 없으므로, 품목/비고 텍스트 안에서 미리 정의한 공종 키워드 사전(예: 철근, 콘크리트, 형틀, 골조, 토공, 조적, 미장, 방수, 타일, 도장, 창호, 유리, 전기, 설비, 소방, 통신, 판넬, 경량, 석공, 조경 등)과 부분 일치하면 그 키워드를 채워 넣는다. 일치하는 키워드가 없으면 빈 칸으로 두고, 이 필드는 `needsReview` 판정에는 포함시키지 않는다(원래도 자주 비어있을 수 있는 필드이므로 매번 배지가 뜨면 오히려 신호가 무뎌짐 — 안내 문구로 "공종은 대부분 직접 입력이 필요합니다"라고 명시).
- `needsReview` 최종 판정: (필수 필드 중 하나라도 비어있음/0) OR (사업자등록번호 두 개 이상 후보라 첫 매치로 임의 채택) OR (금액 3종 정합성 불일치) OR (`parseMethod === 'ocr'`) 중 하나라도 해당하면 `true`.

### 3.3 공사명 필터 구현 방식

목록 상단에 `<select id="project-filter">`를 두고, `invoices` 배열에서 `projectName`이 빈 문자열이 아닌 값들의 중복 제거 집합을 옵션으로 채운다(첫 옵션은 "전체"). 값이 바뀌면 `renderInvoiceTable()`이 `state.invoices.filter(row => filter === '전체' || row.projectName === filter)` 결과만 그린다(원본 배열은 그대로 두고 렌더링 시점에만 걸러 표시 — 삭제/수정은 항상 원본 배열의 해당 id를 찾아 반영). 필터가 "전체"가 아닐 때는 필터된 목록 아래에 합계 요약(건수·공급가액·부가세·합계 합)과 "이 공사명으로 정산서 생성" 버튼을 함께 보여준다.

### 3.4 공사명별 그룹핑 → 정산서 자동 생성 로직

"이 공사명으로 정산서 생성" 클릭 시 `generateSettlementForProject(projectName)` 실행.

1. `settlement-app-saved-projects` 딕셔너리를 읽는다(shared-utils.js `loadSavedProjects()`).
2. `projectName` 키가 **없으면**: `createEmptyState()`(settlement.js에 이미 있는 함수, shared-utils로 옮기거나 그대로 두고 재사용)로 빈 정산서 state를 만들고 `projectInfo.name = projectName`을 설정한다. `projectInfo.supplyAmount`(전체 계약 공급가액)는 계산서 정보만으로는 알 수 없는 값이므로 자동 채우지 않고 0으로 둔다(사용자가 정산서 화면에서 직접 입력).
3. 필터된 계산서 목록(`linkedProjectRowId`가 아직 없는 것만) 각각을 표1(외주·자재비) 행으로 변환한다. 기존 `settlement.js`의 `makeRowFromImport('subcontract', rec)`와 동일한 매핑을 그대로 따른다: `workType`←공종, `issueDate`←발행일, `vendor`←거래처, `bizRegNo`←사업자등록번호, `supplyAmount`←공급가액. `taxInvoiceIssued`는 계산서가 있다는 것 자체가 전자세금계산서 발행 근거이므로 `true`로 채운다. **`paidAmount`는 항상 0으로 시작**(요구사항 그대로, 기존 "결제금액은 실제 결제했을 때만 입력" 로직과 충돌하지 않도록 절대 자동 채우지 않음). 부가세/합계는 기존 로직대로 `supplyAmount`에서 항상 재계산되므로 계산서에서 읽은 vat/total 값은 참고용으로만 쓰고 state에는 넣지 않는다(값이 어긋나면 화면 표시가 아닌 계산서 원본 쪽의 `needsReview`로 사용자가 알게 됨).
4. 새로 추가한 각 subcontract 행의 `id`를 해당 계산서 레코드의 `linkedProjectRowId`에 기록해 저장(다음에 같은 공사명으로 다시 생성 눌러도 같은 계산서가 중복으로 다시 들어가지 않도록).
5. `projectName` 키가 **이미 있으면**(=이미 한 번 생성한 적 있는 정산서): 확인 다이얼로그로 3가지 중 선택하게 한다.
   - **병합(권장, 기본 선택)**: 기존 `savedProjects[projectName]`의 subcontract 배열은 그대로 두고, 아직 `linkedProjectRowId`가 없는(=이번에 새로 필터된) 계산서만 새 행으로 추가. 기존 행에 사용자가 이미 입력해둔 결제금액/계좌정보 등은 절대 건드리지 않는다.
   - **새로 만들기(기존 정산서를 덮어씀)**: `confirm()`으로 한 번 더 강하게 경고("기존에 입력한 결제금액 등 수정 내역이 모두 사라집니다")한 뒤, 2번 경로처럼 완전히 새 state를 만들어 덮어쓴다. 이때 그 공사명으로 이미 반영됐던 모든 계산서의 `linkedProjectRowId`를 초기화해 다시 반영 대상이 되게 한다.
   - **취소**: 아무 것도 하지 않는다.
6. 생성/병합이 끝나면 `savedProjects[projectName]`을 저장하고, "정산서 열기" 버튼(또는 자동으로 index.html로 이동해 해당 공사명이 즉시 선택된 상태)을 안내한다 — index.html 진입 시 `settlement-app-state`(현재 열려 있는 작업 사본)와 방금 생성한 저장소 항목이 다른 공사명이면, 3.1에서 설명한 프로젝트 선택 드롭다운으로 사용자가 명시적으로 골라 불러오게 한다(현재 작업 중인 다른 정산서를 예고 없이 덮어쓰지 않기 위함).

## 4. 입력 처리

- **업로드**: invoices.html 상단에 드래그앤드롭 영역(카드) + "파일 선택" 버튼(`<input type="file" multiple accept=".pdf,image/*">`) 두 가지 경로 모두 제공. 드롭/선택된 파일은 즉시 목록에 "인식 중" 행으로 추가된 뒤 3.2 파이프라인이 백그라운드로 채운다.
- **폴더 연결**: 기존 index.html의 "데이터 폴더 연결"과 동일한 UX 패턴(연결/다른 폴더 선택/새로고침, IndexedDB에 핸들 저장해 다음 방문 시 이어쓰기)을 invoices.js에 별도 구현으로 재현한다. 다만 대상이 JSON이 아니라 PDF/이미지이므로 스캔 확장자 필터만 다르게 하고(`.pdf`, 이미지 확장자), 폴더 안 파일 각각을 자동으로 인식 파이프라인에 태운다(새로고침 후 재연결 시에는 이미 목록에 있는 `fileName`은 건너뛰고 새 파일만 처리). FS Access API 미지원 브라우저는 `webkitdirectory` input으로 대체하되, 이 경우 파일 바이트를 IndexedDB(`files` 스토어)에 저장해야 다음 방문 때도 "원본 보기"가 가능하다는 점을 명시.
- **셀 수정**: 목록 테이블은 settlement.js와 동일한 이벤트 위임 패턴(`<tbody>` 하나에 input/change/click 리스너 하나씩, `data-id` + `data-field`)을 재사용한다. 발행일(`type=date`)·거래처·공종·사업자등록번호(자동 하이픈 포맷, shared-utils의 `formatBizRegNo` 재사용)·금액 3종(콤마 포맷, focus/blur 패턴 재사용)은 모두 인라인 `<input>`. 사용자가 어떤 필드든 값을 바꾸면 그 행의 `needsReview`는 즉시 `false`로 내려가고 `parseMethod`는 `"manual"`로 바뀐다(자동인식 결과를 사람이 검수·확정했다는 의미).
- **공사명 입력**: 각 행의 공사명 칸은 `<input list="project-suggestions">` + `<datalist>`로 지금까지 등장한 공사명을 자동완성 후보로 보여주되 자유 텍스트 입력도 허용(신규 공사명 대응).
- **모바일 터치**: 업로드 버튼·드롭존·필터 드롭다운·행별 액션 버튼(원본보기/다시인식/삭제) 모두 최소 40×40px 터치 영역 확보(기존 앱 기준 재사용). 목록 표는 기존과 동일하게 `.table-scroll` 가로 스크롤 컨테이너로 감싼다. 드래그앤드롭 영역은 모바일에서 드래그가 어려우므로 항상 "파일 선택" 버튼을 드롭존과 나란히 노출해 탭만으로도 업로드 가능하게 한다.

## 5. UI/디자인

- **화면 구조**: 새 HTML 파일(`invoices.html`)로 분리하고, 두 화면 최상단에 얇은 탭 네비게이션 바(`정산서 작성` / `계산서함`, 현재 화면 강조)를 공통으로 추가한다. 하나의 index.html 안에 탭으로 감추는 방식 대신 별도 페이지로 분리한 이유는 Tesseract.js/PDF.js가 무겁고(수 MB) 계산서함을 쓰지 않는 사용자(기존 워크플로우)에게는 그 비용을 전혀 지우지 않기 위함이다.
- **invoices.html 세로 레이아웃**: 헤더(제목 + 다크모드 토글, 기존과 동일) → 탭 네비게이션 → 사용법 안내 박스(guide-box 재사용, 계산서함 전용 문구로 교체) → 업로드/드롭존 카드 → 폴더 연결 카드(기존 index.html 패턴 재사용) → 필터(공사명 드롭다운) + 목록 테이블(순번/발행일/거래처/공종/사업자등록번호/공급가액/부가세/합계/공사명/상태/원본/삭제) → 필터링된 공사명 요약 + "이 공사명으로 정산서 생성" 버튼.
- **다크모드/팔레트**: `/css/style.css` 변수(`--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`)를 그대로 참조하며, 다크모드 토글 메커니즘은 shared-utils.js로 이관해 두 화면이 완전히 동일하게 동작(테마 키도 기존 `settlement-app-theme` 그대로 공유 — 계산서함만 따로 테마가 다르게 보이면 어색하므로).
- **배지/상태 표시**: "확인 필요"는 주황색 계열 배지(`--settlement-danger`류 변수를 재사용하되 경고색은 노랑/주황 톤 새 변수 `--settlement-warning`을 style.css 팔레트 변수 기반으로 추가), "인식 중"은 회색 스피너 배지, "완료(검수됨)"는 배지 없음(정상 상태는 시각적 노이즈를 더하지 않음).
- **사용법 안내 문구 위치**: 기존과 동일하게 헤더 바로 아래 guide-box에 고정 배치. 내용: "① 계산서 PDF/이미지를 업로드하거나 폴더를 연결하면 자동으로 정보를 읽어옵니다. ② '확인 필요' 배지가 붙은 항목은 반드시 클릭해서 값을 확인·수정해주세요(자동인식은 완벽하지 않습니다). ③ 공사명은 자동으로 채워지지 않으니 직접 입력하세요. ④ 같은 공사명끼리 모은 뒤 '정산서 생성' 버튼을 누르면 정산서 작성 화면에 협력업체 내역으로 자동 반영됩니다."

## 6. 한계/주의사항

- **PDF 텍스트 추출의 한계**: 국세청 표준 e-세금계산서라도 발행 주체(홈택스/더존/삼쩜삼 등 발행 대행 서비스)에 따라 레이아웃과 라벨 문구가 조금씩 다르다. 정규식/라벨 탐색이 실패하면 해당 필드는 빈 값으로 남고 `needsReview`가 켜진다 — "완벽한 인식"이 아니라 "타이핑량을 줄여주는 초안"이라는 점을 안내 문구에 명시한다.
- **OCR(Tesseract.js)의 한계**: 한글 인식 정확도는 스캔 해상도·기울기·폰트에 따라 크게 달라지며, 특히 사업자등록번호·금액 같은 숫자열은 한두 자리만 틀려도 치명적이므로(예: "1,000,000"이 "7,000,000"으로 오인식) OCR 결과는 예외 없이 전부 `needsReview`로 강제 표시한다.
- **그래서 "최종 사용자 검토"가 필수 설계 요소인 이유**: 이 데이터는 최종적으로 회사의 정산서·세무 근거 자료가 되므로, 자동인식 값을 검수 없이 그대로 정산서에 반영하면 실제 지급액과 어긋난 금액이 협력업체 내역에 들어갈 위험이 있다. 그래서 (1) 셀 단위로 언제든 즉시 수정 가능한 인라인 입력, (2) 행 단위 "확인 필요" 배지, (3) 정산서 생성 후에도 결제금액/계좌정보 등은 항상 0/빈값으로 시작해 사용자가 실제 지급을 확인하며 채우게 하는 기존 로직을 그대로 유지하는 3중 안전장치로 설계했다.
- **공종 자동 추정의 한계**: 키워드 사전 매칭 방식이므로 사전에 없는 공종명이나 약어는 인식하지 못한다. 애초에 "빈 칸이면 사용자가 채운다"는 것을 기본 전제로 설계했다.
- **폴더/파일 참조 유실**: FS Access API로 연결한 폴더의 권한이 만료되거나 파일이 이동/삭제되면 `fileSource: "missing"`으로 표시하고 "원본 다시 연결" 안내만 하고 목록 데이터(인식된 값)는 보존한다.

## 7. 작업 순서(체크리스트)

1. `shared-utils.js` 생성: 기존 `settlement.js`에서 `round/calcVat/calcTotal/parseNumber/formatNumber/formatBizRegNo/escapeAttr/sanitizeFilenamePart`와 다크모드 관련 함수(`getPreferredTheme/applyTheme/toggleTheme/updateThemeToggleIcon`)를 그대로 옮기고 `window.SettlementShared`로 노출. `loadSavedProjects/saveProjectByName/getSavedProjectNames` 헬퍼(3.1) 추가.
2. `settlement.js`를 수정해 1번에서 옮긴 함수 정의를 제거하고 `SettlementShared.xxx`를 참조하도록 치환. 동작이 전과 완전히 동일한지(회귀 없는지) 우선 확인.
3. `index.html`에 `shared-utils.js` `<script>` 태그를 `settlement.js`보다 먼저 추가.
4. `index.html`에 탭 네비게이션 바 마크업 추가(정산서 작성/계산서함, 계산서함은 `invoices.html`로 이동하는 `<a>`), `style.css`에 스타일 추가.
5. `index.html`의 공사 기본 정보 카드 옆에 "저장된 정산서 불러오기" `<select>` 추가, `settlement.js`에 목록 채우기 + 선택 시 불러오기(확인 다이얼로그 포함) 로직 추가.
6. `settlement.js`의 `onStateChange()`에 "공사명이 있으면 저장소에도 미러 저장" 한 줄 추가.
7. 여기까지 완료 후 **기존 화면만으로 회귀 테스트**: 값 입력/저장/새로고침 복원/엑셀 내보내기/폴더 연결이 이전과 동일하게 동작하는지 확인(계산서함 없이도 이 시점에서 완결된 상태여야 함).
8. `invoices.html` 뼈대 작성: 헤더+탭+가이드박스, 업로드 카드(드롭존+버튼), 폴더 연결 카드, 필터+목록 테이블(빈 tbody), 공사명 요약/생성 버튼 영역. `style.css` + `invoices.css` + `shared-utils.js` + PDF.js/Tesseract.js CDN + `invoices.js` 로드.
9. `invoices.css`: 드롭존, 배지(확인필요/인식중), 필터 드롭다운 등 목록 화면 전용 스타일만 작성(카드/표/버튼은 기존 style.css 클래스 재사용).
10. `invoices.js`에 `invoicesState` 구조·localStorage 저장/복원(`createEmptyInvoicesState`, `loadInvoicesState`, `saveInvoicesState`) 구현.
11. 목록 테이블 렌더 함수 구현(순번 재계산, 상태 배지, 이벤트 위임으로 셀 수정 바인딩) — 우선 자동인식 없이 빈 값 행을 수동으로만 추가/수정/삭제할 수 있는 상태까지 완성 후 확인.
12. 파일 업로드 UI(드롭존 + 버튼) 구현: 파일을 받으면 우선 "인식 중" 임시 행만 목록에 추가하는 것까지 구현(파싱은 다음 단계).
13. PDF.js 연동: CDN 로드, PDF 1페이지 텍스트 추출 함수 구현, 텍스트 부족 시 캔버스 렌더링으로 폴백하는 분기 구현.
14. Tesseract.js 연동: 지연 초기화(첫 사용 시점에만 워커 생성), 이미지/캔버스 OCR 함수 구현.
15. `extractFieldsFromText()` 공통 파서 구현(사업자등록번호/상호/발행일/금액 3종/공종 추정, 3.2절 규칙 그대로) — 단위 테스트하듯 실제 계산서 텍스트 샘플 몇 개로 값을 직접 대조.
16. 12~15을 연결: 업로드된 파일이 확장자별로 PDF-텍스트/PDF-스캔폴백/이미지-OCR 경로를 타고 `extractFieldsFromText()` 결과로 행이 채워지도록 파이프라인 완성, 순차 큐 처리 적용.
17. `needsReview` 판정 로직 구현 및 배지 렌더링, 사용자가 셀을 수정하면 `needsReview=false`/`parseMethod='manual'`로 바뀌는 로직 구현.
18. 폴더 연결 기능 구현(자체 IndexedDB `settlement-invoices-db`: `handles` 스토어로 폴더 핸들, `files` 스토어로 fallback 파일 바이트) — 기존 index.html 폴더 연결 코드 패턴을 참고해 동일 UX로 재구현하되 완전히 독립된 DB 사용.
19. "원본 보기"/"다시 인식" 버튼 구현(폴더 소스/blob 소스 모두 대응, 참조 유실 시 "missing" 상태 처리).
20. 공사명 필터 드롭다운 + 필터링된 요약(건수/합계) + "이 공사명으로 정산서 생성" 버튼 UI 구현.
21. `generateSettlementForProject()` 구현(3.4절 그대로): 신규 생성 경로 먼저 구현 후 확인.
22. 기존 공사명 재생성 시 병합/새로만들기/취소 확인 다이얼로그 및 `linkedProjectRowId` 중복 방지 로직 구현.
23. 생성 완료 후 index.html로 이동해 프로젝트 선택 드롭다운으로 해당 정산서를 바로 열어볼 수 있는지 연동 확인.
24. 라이트/다크 모드 각각 invoices.html 전체 육안 점검, 탭 전환 시 두 화면 스타일 일관성 확인.
25. 모바일 뷰포트(360~414px)에서 업로드 버튼/드롭존/필터/목록 가로 스크롤/배지 가독성 확인.
26. 종단 시나리오 검증: 실제(또는 익명화된 샘플) 세금계산서 PDF 여러 장 업로드 → 자동인식 결과 검수·수정 → 같은 공사명으로 필터 → 정산서 생성 → index.html에서 열어 표1에 정상 반영됐는지, 결제금액이 0으로 시작하는지, 엑셀 내보내기까지 문제없는지 확인. 이어서 같은 공사명으로 계산서 1장을 추가 업로드 후 "정산서 생성"을 다시 눌러 병합 시 중복 반영 없이 새 계산서만 추가되는지 확인.
27. 회귀 테스트 재확인: 계산서함을 전혀 쓰지 않은 사용자 시나리오(index.html 단독 사용)가 1단계와 동일하게 동작하는지 마지막으로 재확인.
