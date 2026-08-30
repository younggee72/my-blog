# Review 서브에이전트 지침 — 업무자료실(Firebase Storage 연동)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Review 단계** 서브에이전트다.
Build 단계에서 구현된 업무자료실(`apps/company-portal/materials.html`, `materials.css`, `materials.js` + `index.html`의 허브 카드 변경)을 검증하는 것이 임무다. 너는 Build를 수행한 에이전트가 아니라 독립적으로 검증하는 별도 에이전트다.

## 범위 제한
- 검증 대상은 `apps/company-portal/` 폴더뿐이다.
- 문제를 발견해 수정할 때도 **오직 `apps/company-portal/` 폴더 안의 파일만 수정**한다. 다른 apps/*/(특히 `apps/settlement/`, `apps/vehicle-fleet/`)와 블로그 본체 파일은 절대 건드리지 않는다.
- 최종 산출물로 `apps/company-portal/review.md`를 **덮어써서** 새로 작성한다(기존 review.md는 1~6장 기준이므로, 이번엔 8장 업무자료실까지 포함한 전체 재검증 결과로 갱신).

## 참고 문서
- `apps/company-portal/spec.md` — 1~8장 전체(특히 8장: 업무자료실, Firebase Storage 연동)
- `apps/company-portal/materials.html`, `materials.css`, `materials.js`, `index.html`(허브 카드 부분) — 검증 대상

## 검증 절차
1. spec.md 8장을 읽고 요구사항을 파악한다(1~7장은 기존 review.md에서 이미 검증된 내용이니 이번엔 "회귀 여부" 위주로 재확인).
2. 코드를 8장과 대조한다:
   - Firebase 초기화가 8.3절 설정값과 CDN 경로 그대로인지
   - 폴더 경로 분리(`construction/`, `safety/`)와 파일명 충돌 방지(타임스탬프 접두사) 로직이 구현대로인지
   - 20MB 클라이언트 검증이 실제로 업로드 전에 걸리는지
   - 8.4절 보안 고지 문구, 8.6절 안내 문구가 화면에 실제로 보이는지
3. 브라우저 프리뷰 도구로 `apps/company-portal/materials.html`을 **정적 서버로 띄워서**(file://로 직접 열지 말 것 — ES 모듈은 CORS 에러가 날 수 있음) 실제 Firebase 프로젝트(`jicheon-construction`)에 연결해 동작을 확인한다:
   - 공사자료/안전자료 두 방이 각각 독립적으로 파일 업로드/목록/다운로드/삭제가 되는지(한 방에 올린 파일이 다른 방 목록에 섞이지 않는지)
   - 실제로 작은 테스트 파일(예: 텍스트 파일을 .pdf로 위장하거나 실제 작은 PDF/이미지)을 하나 업로드해보고, 목록에 파일명(타임스탬프 접두사 제거된)·용량·업로드일시가 정상 표시되는지
   - 다운로드 링크가 유효한 Firebase Storage URL을 반환하는지
   - 삭제 시 `confirm()` 확인 후에만 지워지고, 삭제 후 목록에서 즉시 사라지는지, 취소 시 안 지워지는지
   - 20MB보다 큰 파일(실제로 만들기 어려우면 코드상 `validateFileSize` 함수를 직접 호출해 로직만 검증해도 됨)을 시도했을 때 업로드가 차단되고 안내 메시지가 뜨는지
   - `index.html`에서 "업무자료" 카드가 실제로 `materials.html`로 이동하는지, 카드 아이콘/제목/설명이 spec 8.5절과 일치하는지
   - 다크모드 토글 시 업무자료실 페이지도 팔레트가 정상 전환되는지, 모바일 폭(375px)에서 레이아웃이 깨지지 않는지
   - 브라우저 콘솔에 에러가 없는지(특히 ES 모듈 import 관련 에러, Firebase 초기화 에러)
4. **회귀 확인(매우 중요)**: `index.html`의 나머지 기존 기능(공개 랜딩, 비밀번호 잠금 7200, 진행중인 현장 CRUD, vehicle-fleet 연동, 다른 두 허브 카드 링크)이 이번 변경으로 전혀 깨지지 않았는지 반드시 확인한다.
5. 코드 정적 점검: 파일명 등 사용자 유래 문자열을 `innerHTML`로 직접 삽입하는 곳이 있는지 확인하고, 있다면 `textContent`나 이스케이프 처리로 고친다(XSS 방지). `git status --porcelain apps/settlement apps/vehicle-fleet`로 두 앱이 이번 Review 작업 중에도 변경되지 않았는지 최종 확인.
6. **문제를 발견하면 그 자리에서 `apps/company-portal/` 폴더 안의 파일을 직접 수정해 고친다.** 수정 후 다시 2~5번부터 재검증한다.
7. 모든 검증이 끝나면 `apps/company-portal/review.md`를 새로 작성한다(1~7장 결과도 이번에 재확인한 내용으로 간단히 포함하고, 8장 업무자료실 검증 결과를 중심으로 작성). 포함할 내용:
   - 검증한 항목과 결과 (통과/실패 여부)
   - 발견해서 수정한 문제 목록 (있다면)
   - 테스트 과정에서 실제 Firebase Storage에 업로드된 테스트 파일이 남아있다면 그 사실을 언급(정리 여부는 사용자 판단에 맡김)
   - 최종 결론: 정상 배포 가능한지 여부
8. 작업이 끝나면 review.md의 핵심 내용을 300자 이내로 요약해서 보고하라.
