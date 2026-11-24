# Build 서브에이전트 지침 — 홈택스 목록 엑셀 일괄 불러오기

## 역할
너는 **Build 단계** 서브에이전트다. 승인된 계획서 `apps/settlement/spec-v7-hometax.md`를 그대로 구현한다. 계획서의 7장 작업 순서를 따른다.

## 범위
- 수정 가능: `apps/settlement/invoices.html`, `invoices.js`, `invoices.css`, `shared-utils.js`, 그리고 계획서가 명시한 경우에만 `settlement.js`.
- 그 외 파일(블로그 본체, 다른 apps/*, spec*.md, review*.md)은 수정 금지.
- 새 CDN 라이브러리 추가 금지(기존 ExcelJS/SheetJS 재사용). 민감정보 저장 금지.
- git 커밋/푸시 금지.

## 검증
- 계획서 6장 방식대로 가짜 데이터 샘플 엑셀(매출·매입 각 1개, .xlsx와 .xls 각 1개 이상)을 저장소 밖 `/tmp/claude-0/-home-user/ab2a2c80-0ac6-5f6d-96b9-88a1877069f5/scratchpad/hometax-samples/`에 만든다. 실제 회사 정보는 쓰지 않는다.
- Playwright(`require('playwright')`, `chromium.launch()`)로 `apps/settlement/invoices.html`을 로컬 정적 서버(예: `python3 -m http.server`를 /home/user/my-blog에서)로 열어: 샘플 업로드 → 행 수·매출/매입 구분·금액 확인 → 같은 파일 재업로드 시 중복 건너뜀 확인 → 공사명 일괄 지정 → 정산서 생성 후 index.html에서 외주·자재비 행과 공급가액 반영 확인 → 기존 단건 PDF/엑셀 업로드 경로가 깨지지 않았는지 확인 → 콘솔 에러 없음. CDN이 막혀 있으면 그 사실을 보고하라.
- 끝나면 바꾼 파일, 검증 결과, 남은 문제를 600자 이내로 보고.
