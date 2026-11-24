# Review 서브에이전트 지침 — 홈택스 목록 엑셀 일괄 불러오기

## 역할
너는 **Review 단계** 서브에이전트다. Build와 분리된 검증자로서 `apps/settlement/spec-v7-hometax.md` 대로 구현됐는지 확인하고 `apps/settlement/review-v7-hometax.md`를 작성한다. 문제를 찾으면 `apps/settlement/invoices.js`, `invoices.html`, `invoices.css`, `shared-utils.js` 안에서만 고친다. git 커밋/푸시 금지.

## 확인할 것
1. 코드 리뷰: 이번 브랜치 변경(`git diff HEAD~1 -- apps/settlement` 등, 기준은 커밋 "홈택스 엑셀 불러오기 Build 지침 추가" 이후)에서 버그, 기존 단건 PDF/이미지/엑셀 경로 회귀, 기존 localStorage 데이터(direction 없는 행) 호환, 금액 파싱(쉼표·음수·수정세금계산서), 날짜 파싱(문자열/엑셀 날짜 숫자/Date), 중복 판정, XSS(엑셀 값이 innerHTML로 들어가는지).
2. 브라우저 검증: Playwright(`require('playwright')`, 재설치 금지)로 /home/user/my-blog를 정적 서버로 띄워, 직접 만든 가짜 샘플(저장소 밖 scratchpad `/tmp/claude-0/-home-user/ab2a2c80-0ac6-5f6d-96b9-88a1877069f5/scratchpad/review-samples/`)로: 두 세트 헤더/한 세트 헤더("공급받는자등록번호(종사업장 번호)") 모두, 매출·매입, 재업로드 중복, 공사명 일괄 지정, 정산서 생성 반영, 모바일 폭(390px) 레이아웃, 다크모드, 콘솔 에러. CDN이 막혀 있으면 node_modules나 npm 캐시에서 같은 버전 파일로 route 대체.
3. 결과를 review-v7-hometax.md에 정리(통과/수정한 것/남은 위험)하고 500자 이내로 보고.
