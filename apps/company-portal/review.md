# company-portal — Review 결과 (재검증: spec.md 8장 업무자료실/Firebase Storage 연동 포함)

Build 단계와 독립된 Review 서브에이전트로서 `apps/company-portal/`을 spec.md 1~8장 전체와 대조하고, 정적 서버(`http://localhost:8000`)로 실제 브라우저에서 검증했다(`file://` 직접 열기 사용 안 함 — ES 모듈 CORS 및 `crypto.subtle` 제약 회피). 8장(업무자료실)은 실제 Firebase 프로젝트(`jicheon-construction`)에 연결해 업로드·목록조회·다운로드·삭제까지 실제로 수행했다. 1~7장은 회귀 여부 위주로 재확인했다.

## 1. 코드 정적 점검 — spec.md 8.3절 대조

| 항목 | 결과 |
|---|---|
| Firebase 초기화 코드(CDN 경로 `firebase-app.js`/`firebase-storage.js` 10.12.2, `firebaseConfig` 값) | 통과 — `materials.js` 상단이 spec 8.3절과 100% 일치. 브라우저에서 `getApps()[0].options`로 실제 로드된 config를 확인해 `projectId: "jicheon-construction"` 등 전 필드 일치 확인 |
| 폴더 경로 분리(`construction/`, `safety/`) | 통과 — `buildStoragePath`/`refreshFileList`가 `room` 인자로 경로 분기, 실제 두 방의 파일 목록이 서로 섞이지 않음을 브라우저에서 확인 |
| 파일명 충돌 방지(타임스탬프 접두사) 및 표시명 복원 | 통과 — 업로드 시 실제 저장 경로가 `construction/1788058170944_REVIEW_TEST_UPLOAD.pdf`였고, 목록에는 `REVIEW_TEST_UPLOAD.pdf`로 접두사 제거되어 표시됨을 확인(`displayName` 정규식 정상 동작) |
| 20MB 클라이언트 검증이 업로드 전에 차단 | 통과 — 21MB 더미 파일로 업로드 시도 시 `uploadBytesResumable` 호출 전에 차단되고 spec과 동일한 문구(`"big_test_file.pdf" 파일이 20MB를 초과합니다. (21.0 MB) ...`) 노출, 목록에 반영 안 됨 확인 |
| 사용자 유래 문자열(파일명 등)을 `innerHTML`로 직접 삽입하는지 | 문제 없음 — `materials.js`는 `el()` 헬퍼로 전부 `textContent`만 사용하고, `innerHTML`은 `fileList.innerHTML = ''`(목록 초기화) 2곳뿐. 수정 불필요 |

## 2. 브라우저 실동작 검증 — 8장 업무자료실 (실제 Firebase 연동)

- **허브 카드 교체**: `index.html`의 3번째 허브 카드가 기존 `hub-card-disabled`("🧩 기타 업무 도구") 대신 `<a class="hub-card" href="materials.html">`(아이콘 📁, 제목 "업무자료", 설명 "공사자료·안전자료 파일을 업로드하고 공유합니다.")로 정상 교체됨. 클릭 시 실제로 `materials.html`로 이동 확인. 잔존 `hub-card-disabled`/"기타 업무 도구" 문자열 없음(grep 확인).
- **Firebase 초기화**: 콘솔 에러 없이 로드, ES 모듈 import 정상 동작(정적 서버 경유이므로 CORS 문제 없음).
- **목록조회(실제 버킷)**: 페이지 진입 시 `listAll`이 실제로 두 방(`construction/`, `safety/`)을 각각 조회. `safety/` 방에는 이전 단계(Build)에서 남긴 것으로 보이는 실제 파일 `안전점검표.xls`(52B, 업로드일시 2026-08-30 오전 11:45:44)가 정상 표시됨.
- **업로드(실제)**: `construction/` 방에 `REVIEW_TEST_UPLOAD.pdf`를 실제로 업로드 → 목록에 파일명(접두사 제거)·용량(68 B)·업로드일시가 정상 표시됨을 확인.
- **다운로드 링크 유효성**: "다운로드" 클릭 시 호출되는 URL을 가로채 확인한 결과 `https://firebasestorage.googleapis.com/v0/b/jicheon-construction.firebasestorage.app/o/construction%2F...REVIEW_TEST_UPLOAD.pdf?alt=media&token=...` 형태의 정상 Storage 다운로드 URL이었고, 실제로 그 URL을 새 탭에서 열어 파일 다운로드가 실제로 트리거됨을 확인(브라우저가 "파일 다운로드" 응답을 받아 저장 대화상자를 띄움 — 유효한 URL이라는 뜻).
- **삭제 — 취소**: `confirm()`에 "취소"를 시뮬레이션 → 안내 문구("\"REVIEW_TEST_UPLOAD.pdf\" 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")가 spec과 동일했고, 파일이 목록에서 그대로 유지됨을 확인.
- **삭제 — 확인**: `confirm()`에 "확인"을 시뮬레이션 → `deleteObject` 호출 후 실제로 Storage에서 삭제되고 목록이 즉시 갱신되어 "아직 업로드된 파일이 없습니다."로 전환됨을 확인. (업로드했던 테스트 파일은 이 과정에서 삭제되어 정리됨 — 아래 5절 참고.)
- **방 격리**: 공사자료/안전자료 두 방의 파일 목록이 서로 전혀 섞이지 않고 독립적으로 표시됨을 실제 데이터로 확인(공사자료에 올린 파일이 안전자료 목록에 나타나지 않음, 그 반대도 마찬가지).
- **탭 전환**: "1. 공사자료" ↔ "2. 안전자료" 클릭 시 각 방의 업로드 영역/목록이 정상 전환됨.
- **다크모드**: 토글 시 헤더/가이드박스/탭/업로드영역/파일카드 전체가 다른 앱과 동일한 팔레트로 정상 전환됨(스크린샷으로 확인).
- **모바일(375px)**: 가로 스크롤 없음(`scrollWidth === clientWidth === 375`), 업로드 영역이 세로 스택으로 전환, 다운로드/삭제 버튼이 44px 이상 터치 타깃 유지.
- **보안 고지/사용법 안내(8.6절) 문구**: `guide-box`에 (1) "공유 저장소(Firebase Storage)" 고지, (2) "URL을 아는 사람은 누구나 업로드·다운로드·삭제 가능" 고지, (3) "파일 1개당 최대 20MB" 안내 3개 항목 모두 화면에 실제 렌더링됨을 확인.
- **콘솔 에러**: 위 전체 시나리오(초기화, 목록조회, 업로드, 다운로드, 삭제 취소/확인, 20MB 초과 시도, 탭 전환, 다크모드, 모바일) 진행 중 콘솔 에러 0건.

## 3. 회귀 확인 — spec.md 1~7장(허브 + 현장관리 + 공개 랜딩/비밀번호 잠금)

- **공개 랜딩**: 최초 진입 시 히어로("주식회사 지천건설" 등)·사업분야 3카드·시공실적 3카드·연락처 섹션만 노출되고, 내부 레이어는 잠긴 상태로 시작함을 확인.
- **비밀번호 잠금**: 틀린 비밀번호("0000") 입력 시 인라인 에러("비밀번호가 올바르지 않습니다.") 표시 및 미통과, 올바른 비밀번호("7200") 입력 시 내부 레이어(업무 도구 3카드 + 진행중인 현장 2건)가 정상 노출되고 잠금 버튼이 "🔓 잠금 해제됨 (다시 잠그기)"로 전환됨을 확인.
- **진행중인 현장 CRUD**: 시드 데이터 2건(oo아파트 신축공사/oo물류센터 증축공사)이 기존과 동일하게 카드 목록에 정상 표시(금액 정보 미노출), 단계 배지·공정률·담당자·기간 정상 표시.
- **허브 카드(정산서/차량관리)**: "현장정산서 자동화 도구", "법인차량 관리" 카드가 각각 `../settlement/index.html`, `../vehicle-fleet/index.html` 링크를 그대로 유지(변경 없음).
- **파일 격리**: `git status --porcelain apps/settlement apps/vehicle-fleet` — Review 작업 전후로 두 폴더에 변경 없음(기존부터 있던 미추적 `apps/settlement/_review_tmp/`만 존재, 이번 세션에서 생성/수정한 파일 아님).
- **콘솔 에러**: 위 회귀 시나리오 전체 진행 동안 콘솔 에러 0건.

## 4. 발견해서 수정한 문제

없음. `materials.html`/`materials.css`/`materials.js`와 `index.html`의 허브 카드 변경 모두 spec.md 8장 요구사항과 완전히 일치했으며, 실제 Firebase 연동 테스트(업로드/목록/다운로드/삭제/20MB 차단/방 격리)까지 전 항목 통과했다. 이번 Review에서 `apps/company-portal/` 내 파일을 수정하지 않았다.

## 5. 테스트 과정에서 실제 Firebase Storage에 남은 파일

- 이번 Review에서 `construction/` 방에 업로드한 테스트 파일(`REVIEW_TEST_UPLOAD.pdf`)은 삭제 기능 검증을 위해 업로드 후 그 자리에서 삭제까지 완료해 **정리됨**.
- 다만 `safety/` 방에 `안전점검표.xls`(52B, 2026-08-30 오전 11:45:44 업로드)가 남아있는 것을 확인했다. 이는 이번 Review 세션에서 업로드한 파일이 아니라 이전 Build 단계에서 남긴 것으로 보이는 실제 테스트 데이터로 추정된다. 삭제 여부는 사용자 판단에 맡긴다(원하면 `materials.html`의 안전자료 탭에서 직접 삭제 가능).

## 6. 최종 결론

**정상 배포 가능.** spec.md 8장이 요구한 업무자료실(Firebase Storage 실연동 — 초기화값, 방 분리, 파일명 충돌 방지, 20MB 검증, 업로드/목록/다운로드/삭제, 보안 고지 문구)이 코드 대조와 실제 `jicheon-construction` 프로젝트 대상 브라우저 테스트 양쪽에서 전부 확인되었다. 1~7장(공개 랜딩, 비밀번호 잠금, 현장 CRUD, 허브 카드)도 이번 8장 추가로 전혀 회귀하지 않았다. `apps/settlement/`, `apps/vehicle-fleet/`, 블로그 본체 파일에는 어떠한 변경도 없었다.
