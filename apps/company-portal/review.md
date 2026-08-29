# company-portal — Review 결과 (재검증: spec.md 7장 개편분 포함)

Build 단계와 독립된 Review 서브에이전트로서 `apps/company-portal/`을 spec.md 1~7장 전체와 대조하고, 정적 서버(`http://localhost:8000`)로 실제 브라우저에서 검증했다(`file://` 직접 열기는 사용하지 않음 — `crypto.subtle` 제약 회피). 기존 review.md는 1~6장(허브+현장관리) 기준이었으므로, 이번엔 7장(공개 랜딩 + 비밀번호 잠금) 검증을 중심으로 하고 1~6장은 회귀 여부를 재확인했다.

## 1. 코드 정적 점검 — spec.md 7.3절 대조

| 항목 | 결과 |
|---|---|
| 평문 "7200"이 코드에 노출되지 않음(`grep "7200" *.js *.html *.css`) | 통과 — `portal.js` 주석("평문 비밀번호는 저장하지 않는다"는 설명문) 1건 외 없음 |
| `PASSWORD_HASH` 값이 실제 `sha256("7200")`과 일치 | 통과 — Node `crypto.createHash('sha256').update('7200').digest('hex')`로 교차 계산해 `portal.js`의 `3c5d8ca315f8c36d4cd4beecbc55b34c92a2d6eb1df730908df6f23dd2aa08f7`(64자)와 일치 확인 |
| `sessionStorage` 사용(요구사항상 `localStorage` 아님) | 통과 — `UNLOCK_SESSION_KEY`를 `isUnlocked/setUnlocked/lockAgain`에서 전부 `sessionStorage`로 처리(`localStorage` 미사용) |
| 보안 한계 고지 문구가 화면에 실제로 보임 | 통과 — 공개 랜딩 하단(`unlock-hint`), 비밀번호 모달 하단, `guide-box` 안내 목록 3곳에 모두 렌더링 확인 |
| vehicle-fleet 키(`vehicle-fleet-vehicles`)에 대한 `setItem` 호출 | 0건 — 읽기 전용 원칙 준수(코드 `grep` 확인) |

## 2. 브라우저 실동작 검증 — 7장 개편분

- **초기 진입**: 공개 랜딩(히어로 "주식회사 지천건설" + 슬로건, 사업분야 3카드, 시공실적 3카드, 연락처)만 보이고, 내부 레이어는 DOM상 `<section id="internal-area" hidden>`로 실제로 숨겨져 있음(업무 도구 카드·진행중인 현장 미노출) 확인.
- **잠금 버튼**: "🔒 직원 전용 업무 시스템" 클릭 → 비밀번호 모달(`inputmode="numeric" maxlength="4" type="password"`) 정상 오픈.
- **틀린 비밀번호**: "0000" 입력 → "비밀번호가 올바르지 않습니다" 인라인 에러 표시, 내부 레이어 미노출 확인.
- **올바른 비밀번호**: "7200" 입력 → 모달 닫힘, 내부 레이어(업무 도구 3카드 + 진행중인 현장 2건) 즉시 노출, 잠금 버튼 라벨이 "🔓 잠금 해제됨 (다시 잠그기)"로 전환됨을 확인.
- **세션 유지**: 같은 탭에서 다른 페이지(settlement/vehicle-fleet)로 이동 후 URL 재입력으로 돌아와도 `sessionStorage.getItem('company-portal-unlocked')==='true'`이고 내부 레이어가 계속 노출됨(같은 탭·같은 오리진이므로 유지, 스펙 7.3절 6번 항목과 일치).
- **새 탭 재잠금**: 새 탭을 열어 동일 URL 접속 시 `sessionStorage`가 비어있어(`null`) 다시 공개 랜딩만 보이는 잠긴 상태로 시작함을 확인(스펙 7.3절의 sessionStorage 특성과 일치).
- **다시 잠그기**: 잠금 해제 상태에서 버튼 클릭 → `sessionStorage` 항목 즉시 제거, 내부 레이어 재차 `hidden` 처리, 버튼 라벨 원상 복귀 확인.
- **모바일 뷰(375px)**: 레이아웃 가로 스크롤 없이 1열 정렬, 비밀번호 입력 필드 `inputmode="numeric"` 속성 유지 확인(모바일에서 숫자 키패드 유도). 모달 버튼 등 터치 타깃 44px 이상 유지.
- **다크모드 토글**: 라이트↔다크 전환 시 공개 랜딩(히어로/카드/배지/연락처)과 내부 레이어(허브 카드/현장 카드/모달) 모두 팔레트 정상 전환. "예시 문구" 배지(`placeholder-badge`)도 다크모드에서 대비가 유지됨.
- **플레이스홀더 안내 문구**: 히어로 슬로건 아래("⚠️ 예시 문구입니다..."), 연락처 상단("⚠️ 아래 연락처는 예시입니다...") 배지 모두 화면에 실제 렌더링 확인.

## 3. 회귀 확인 — spec.md 1~6장(기존 허브 + 현장관리)

- **현장 카드 목록**: 시드 데이터 2건(oo아파트 신축공사/oo물류센터 증축공사)이 기존과 동일하게 정상 표시, 카드에 금액 정보 미노출 확인.
- **상세 모달**: 카드 클릭 → 계약금액/기성 청구액/기성 수금액이 상세에서만 노출, `vehicle-fleet-vehicles`와 매칭된 투입 차량(예: "12가 1001 (porter)")이 정상 표시됨을 확인.
- **허브 카드 이동**: "현장정산서 자동화 도구" 클릭 시 실제로 `http://localhost:8000/apps/settlement/index.html`로, "법인차량 관리" 클릭 시 `http://localhost:8000/apps/vehicle-fleet/index.html`로 이동함을 `window.location.href`로 직접 확인. "기타 업무 도구"는 비활성 placeholder로 클릭 불가 유지.
- **현장 등록/검증**: 필수값(현장명/위치/착공일/담당자) 비운 채 제출 시 4개 필드 인라인 에러 표시 및 제출 차단 확인(변경 없음).
- **XSS 방어**: 현장명에 `<img src=x onerror=alert(1)>` 페이로드로 신규 등록 → 목록 카드·상세 모달 어디에서도 스크립트 실행 없이 이스케이프된 문자 그대로 표시됨을 확인(`escapeHtml` 정상 동작, 7장 개편으로 신규 추가된 코드 경로에는 영향 없음 — 렌더링 로직 자체는 6장에서 이미 구현된 것을 그대로 사용). 테스트 후 해당 테스트 데이터는 정리함.
- **파일 격리**: `git status --porcelain apps/settlement apps/vehicle-fleet` — Review 작업 전후로 두 폴더에 변경 없음(기존에 있던 미추적 `apps/settlement/_review_tmp/`만 그대로 존재, 이번 세션에서 생성/수정한 파일 아님).
- **콘솔 에러**: 위 시나리오 전체 진행 동안 콘솔 에러 0건.

## 4. 발견해서 수정한 문제

없음. 1차 구현 상태에서 spec.md 1~7장 요구사항 전 항목이 통과했으며, `apps/company-portal/` 내 파일을 이번 Review에서 수정하지 않았다.

## 5. 최종 결론

**정상 배포 가능.** spec.md 7장이 요구한 "공개 랜딩(비밀번호 불필요) + 비밀번호 잠금(sessionStorage, SHA-256 해시, 평문 미노출, 보안 한계 고지)" 설계가 코드와 실제 브라우저 동작 모두에서 확인되었고, 1~6장에서 이미 검증된 현장 CRUD·금액 정보 노출 제어·vehicle-fleet 읽기 전용 연동·다크모드·XSS 방어도 이번 개편으로 전혀 회귀하지 않았다. `apps/settlement/`, `apps/vehicle-fleet/`, 블로그 본체 파일에는 어떠한 변경도 없었다.
