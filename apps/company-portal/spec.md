# company-portal — 사내 포털(회사 홈페이지) 계획서

## 1. 개요

`apps/company-portal/`는 개인 블로그 홈(`index.html`)과는 별개로, 회사 업무용 허브 역할을 하는 정적 웹앱이다. 크게 두 가지 성격을 한 화면에 담는다.

1. **허브(포털) 성격**: 이미 구현되어 있는 업무용 미니앱 두 개 — 현장정산서 자동화 도구(`apps/settlement/`)와 법인차량 관리(`apps/vehicle-fleet/`) — 를 카드 형태로 모아 보여주고, 클릭하면 각 앱으로 이동한다. 두 앱의 코드/데이터는 절대 수정하지 않고 순수 링크(+선택적 iframe 미리보기)로만 연결한다.
2. **현장관리 성격(신규 기능)**: 회사가 현재 진행 중인 공사 현장을 등록·조회·수정·삭제할 수 있는 기능을 이 앱 안에 직접 구현한다. 기본정보, 진행상태, 금액정보(민감정보라 목록에서는 요약만 노출), 투입 장비/차량 연결까지 4개 영역을 모두 포함한다.

서버 없이 정적 파일 + localStorage만으로 동작하며, 다른 apps/*나 블로그 본체 파일은 건드리지 않는다.

## 2. 파일 구조

```
apps/company-portal/
├── index.html      # 포털 진입점. 허브 카드 섹션 + 진행중인 현장 섹션 + 폼(모달/패널)의 마크업 뼈대
├── style.css        # 이 앱 전용 스타일. /css/style.css의 CSS 변수(--color-*, --font-*)만 참조하고 값은 재정의하지 않음
├── portal.js         # 상수(허브 카드 목록, 현장 상태 단계 등) + 데이터 스키마 + localStorage 읽기/쓰기 + vehicle-fleet 연동 헬퍼
├── app.js            # 화면 렌더링, 폼 입력/검증, CRUD 이벤트 바인딩, 다크모드 토글 로직
└── spec.md           # (본 문서)
```

- 기존 vehicle-fleet(`fleet.js` / `app.js` 분리) 패턴을 따라 "데이터 계층(portal.js)"과 "UI 계층(app.js)"을 분리한다.
- 별도 라이브러리는 쓰지 않는다(순수 HTML/CSS/JS). CDN 아이콘 폰트 등도 굳이 쓰지 않고 이모지 아이콘으로 대체(다른 앱들과 동일한 패턴).

## 3. 핵심 로직 설계

### 3.1 localStorage 키

기존 앱들과 접두사가 겹치지 않도록 `company-portal-` 접두사를 사용한다.

| 키 | 용도 |
|---|---|
| `company-portal-sites` | 진행중인 현장 목록(배열) |
| `company-portal-initialized` | 최초 실행 시 샘플 데이터 시딩 여부 플래그 |

vehicle-fleet의 `vehicle-fleet-vehicles`, settlement 쪽 키와는 절대 겹치지 않는다. (vehicle-fleet은 `vehicle-fleet-vehicles`, `vehicle-fleet-schedules`, `vehicle-fleet-consumables`, `vehicle-fleet-initialized` 등을 사용 중임을 확인함.)

### 3.2 현장(site) 데이터 스키마

```js
{
  id: "site_xxxxx",              // generateId('site') 형태의 고유 ID
  name: "",                       // 현장명
  address: "",                    // 위치(주소)
  startDate: "",                  // 착공일 (ISO date string, YYYY-MM-DD)
  endDatePlanned: "",              // 준공예정일
  manager: "",                    // 담당자(현장소장 등)

  // 진행상태 — 공정률(%)과 단계를 함께 지원한다(아래 3.3 설계 결론 참고)
  progressPercent: 0,              // 0~100 숫자
  stage: "before-start",           // 착공전 | foundation | frame | finishing | completed 중 하나

  // 금액 정보 — 민감정보. 목록에는 노출하지 않고 상세 펼침에서만 표시
  contractAmount: 0,               // 계약금액(원)
  billedAmount: 0,                 // 기성 청구액(원)
  collectedAmount: 0,               // 기성 수금액(원)

  // 투입 장비/차량
  vehiclePlates: [],               // vehicle-fleet 차량번호(plateNumber) 문자열 배열 — 드롭다운/체크박스로 선택된 값
  vehicleFreeText: "",             // 자유 입력 텍스트(드롭다운에 없는 차량/장비를 직접 타이핑)

  memo: "",                        // 비고(선택)
  createdAt: "",                   // ISO datetime
  updatedAt: ""                    // ISO datetime
}
```

- **진행상태 설계 결론**: 공정률(%)과 단계(착공전/기초/골조/마감/준공) 둘 다 지원한다. 단계는 목록 카드에서 배지로 한눈에 보여주기 좋고, 공정률은 막대 그래프로 세밀한 진척을 보여주기 좋아 상호 보완적이다. 입력 폼에서는 단계는 select, 공정률은 슬라이더 또는 숫자 입력(0~100)으로 받는다. 단계를 바꾸면 공정률의 대략적 구간을 추천값으로 채워주되(예: '골조' 선택 시 40으로 프리필) 사용자가 직접 덮어쓸 수 있게 한다.
- **금액 필드는 모두 정수(원 단위)로 저장**하고, 화면 표시 시에만 `toLocaleString('ko-KR')`로 천단위 구분 + "원" 접미사를 붙인다.

### 3.3 vehicle-fleet 연동 설계 (읽기 전용 참조) — 트레이드오프 및 결론

**검토한 방식**
- **1안(채택)**: `company-portal`이 `localStorage.getItem('vehicle-fleet-vehicles')`를 **읽기 전용**으로 조회해 차량 목록(포터 6대, 덤프 1대, 포크레인 1대, 승용차 1대 등)을 드롭다운/체크박스로 보여주고, 사용자가 그 중 이 현장에 투입된 차량을 다중 선택하게 한다. 선택 결과는 차량번호(`plateNumber`) 문자열만 `company-portal-sites`의 `vehiclePlates` 배열에 저장한다(즉 vehicle-fleet 레코드를 복제하거나 참조 ID로 묶지 않고, 표시용 문자열만 복사 저장 — 두 앱 간 강한 결합을 피함).
- **2안(대안)**: 아예 차량 연동 없이 자유 입력 텍스트로만 받고, "차량은 법인차량 관리 앱에서 별도로 확인하세요"라는 안내 문구와 링크만 제공.

**결론**: 1안을 기본으로 채택하되, 항상 2안(자유 입력)을 병행 제공한다.

- 장점: 같은 오리진에서 서빙되는 정적 사이트 특성상 별도 서버/파일 없이도 실제 등록된 차량 목록을 즉시 활용할 수 있어 사용자 입력 실수(오타)를 줄이고 UX가 좋아진다.
- 위험 (a) — **스키마 결합**: vehicle-fleet의 `VEHICLES_KEY`(`'vehicle-fleet-vehicles'`) 데이터 구조(현재 각 항목은 `{ id, plateNumber, vehicleType, ... }`)가 바뀌면 이 앱의 파싱이 깨질 수 있다. 대응: 읽기 시 반드시 `try/catch` + 각 필드 존재 여부를 방어적으로 확인(`Array.isArray` 체크, `plateNumber` 없는 항목은 skip)하고, 실패 시 조용히 빈 배열로 폴백한다(에러로 전체 화면이 죽지 않게).
- 위험 (b) — **빈 목록**: vehicle-fleet을 한 번도 연 적 없는 브라우저에서는 `vehicle-fleet-vehicles` 키 자체가 없어 드롭다운이 비어 보일 수 있다. 대응: 그 경우 "등록된 차량이 없습니다. 법인차량 관리에서 먼저 등록하거나 아래에 직접 입력하세요" 안내 문구를 보여주고, 자유 입력 필드(`vehicleFreeText`)를 항상 함께 노출한다.
- **"자체 완결" 원칙과의 관계**: 이 읽기 전용 연동은 파일/코드 수준에서는 vehicle-fleet의 어떤 파일도 import하거나 수정하지 않으므로 "다른 앱의 코드/데이터를 건드리지 않는다"는 규칙은 지킨다. 다만 브라우저 저장소(같은 오리진 localStorage)를 통해 **논리적으로는 약하게 결합**되므로, 이 의존을 최소화하기 위해 (1) 조회는 항상 read-only, (2) 실패해도 항상 동작하는 폴백(자유 입력) 제공, (3) vehicle-fleet 키 이름과 필드명을 상수로 한 곳(`portal.js` 상단)에 모아 향후 스키마 변경 시 수정 지점을 한 곳으로 최소화하는 방식으로 리스크를 관리한다. 이 정도 결합은 "완전히 별개의 앱이지만 같은 회사 데이터를 다루는 포털" 이라는 이 앱의 목적에 부합한다고 판단해 채택한다.

### 3.4 초기 샘플 데이터

앱 최초 로드시(`company-portal-initialized` 플래그 없을 때) 현장 2건을 시딩한다.

1. `oo아파트 신축공사` — 위치: `서울시 OO구 OO동 123`, 착공일 2026-03-02, 준공예정일 2027-08-31, 담당자 `김현장`, stage `frame`(골조), progressPercent `45`, contractAmount `3,200,000,000`, billedAmount `1,400,000,000`, collectedAmount `1,200,000,000`, vehiclePlates 예시로 vehicle-fleet 시드 차량 중 일부(예: 포터 1~2대 plateNumber, 존재하면) 매칭 시도 — 없으면 빈 배열 + vehicleFreeText `"포터 2대, 포크레인 1대 투입"`.
2. `oo물류센터 증축공사` — 위치: `경기도 OO시 OO로 45`, 착공일 2026-06-10, 준공예정일 2026-12-20, 담당자 `박소장`, stage `foundation`(기초), progressPercent `15`, contractAmount `980,000,000`, billedAmount `150,000,000`, collectedAmount `150,000,000`, vehiclePlates 빈 배열, vehicleFreeText `"덤프 1대 상시 투입"`.

시드 데이터는 `portal.js`에 상수 배열로 정의한다.

## 4. 입력 처리

- **현장 등록**: "새 현장 등록" 버튼 → 폼(모달 또는 인라인 패널, vehicle-fleet의 폼 패턴과 유사)이 열림. 필수 항목(현장명, 위치, 착공일, 담당자)은 비어있으면 제출 차단 + 필드별 인라인 에러 메시지(다른 앱과 동일 패턴인 `showFieldError` 류 헬퍼 재사용/유사 구현).
- **현장 수정**: 목록 카드 또는 상세 뷰에서 "수정" 클릭 → 동일 폼에 기존 값 프리필.
- **현장 삭제**: "삭제" 클릭 → `confirm()` 확인 후 삭제(vehicle-fleet 패턴과 동일하게 되돌릴 수 없음을 명시).
- **차량 선택 UI**: vehicle-fleet 차량 목록을 체크박스 리스트로 표시(항목 없으면 안내 문구), 그 아래 "직접 입력(자유 텍스트)" textarea/input을 항상 함께 배치. 저장 시 체크된 plateNumber들 + 자유 입력 텍스트를 함께 저장.
- **진행상태 입력**: 단계 select + 공정률 숫자 입력(0~100, `type="number"` 또는 `type="range"` 슬라이더 병행 — 슬라이더 조작이 불편한 모바일 환경 고려해 숫자 입력도 항상 노출).
- **금액 입력**: `type="number"` 또는 `inputmode="numeric"` 텍스트 입력, 입력 중 실시간으로 천단위 콤마 미리보기를 보여주는 것을 고려(과하면 생략 가능 — Build 단계 재량).

## 5. UI/디자인

### 5.1 전체 레이아웃 (위→아래)

1. **헤더**: 사이트 타이틀("사내 포털" 등) + 다크모드 토글 버튼(다른 앱과 동일한 우상단 원형 버튼 패턴).
2. **허브 카드 섹션** ("바로가기" 또는 "업무 도구"):
   - 카드 1: 현장정산서 자동화 도구 — 아이콘 + 제목 + 짧은 설명 + `../settlement/index.html` 링크. 블로그 홈의 `app-card` 패턴(아이콘/제목/설명, 선택적 iframe 미리보기)을 참고하되, 이 포털은 업무용이라 iframe 미리보기보다는 가벼운 아이콘+텍스트 카드로 단순화(로드 비용/속도 우선). iframe 미리보기는 선택사항으로 남기고 Build 단계에서 최종 판단.
   - 카드 2: 법인차량 관리 — 동일 패턴으로 `../vehicle-fleet/index.html` 링크.
   - 카드 3: "기타 업무 도구 (추후 추가 예정)" — 비활성/점선 테두리 placeholder 카드 1개. 클릭 불가 또는 "준비 중" 안내만. 과하게 만들지 않는다.
3. **진행중인 현장 섹션**:
   - 상단에 "새 현장 등록" 버튼 + 현재 등록된 현장 수 표시.
   - 카드 목록(각 카드에 현장명, 위치, 담당자, 단계 배지, 공정률 막대바, 착공~준공예정일). **금액 정보는 카드에 표시하지 않는다.**
   - 카드 클릭(또는 "상세 보기" 버튼) → 상세 패널/모달이 펼쳐지며 그때 계약금액/기성 청구·수금 현황, 투입 차량 목록까지 모두 표시. 상세 패널에는 "금액 정보"라는 소제목과 함께 살짝 구분되는 배경(`--color-bg-secondary`) 박스로 감싸 시각적으로도 "민감 정보 영역"임을 표시.
   - 각 카드/상세에 수정·삭제 버튼.
4. **사용법 안내**: 페이지 하단 또는 최초 진입 시 상단에 접을 수 있는 안내 박스(다른 앱들의 "사용법" 패턴 참고)로 다음을 포함:
   - 이 페이지는 브라우저(로컬 저장소)에만 데이터가 저장되며 서버로 전송되지 않는다는 점.
   - 금액 정보는 상세를 펼쳐야 보인다는 점.
   - 차량은 법인차량 관리 앱에 등록된 목록에서 선택하거나 직접 입력할 수 있다는 점.
5. **"기타 확장" 자리**: 위 3번의 카드 3(placeholder)로 충분 — 별도 섹션을 추가로 만들지 않는다(과하게 만들지 말 것 원칙 준수).

### 5.2 스타일 원칙

- `/css/style.css`는 링크하지 않고(다른 apps와 동일하게 앱이 자체 완결), 이 앱 전용 `style.css`에서 동일한 CSS 변수 이름(`--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`, `--font-body`, `--font-mono`)을 `:root`에 동일 값으로 재선언하고, 다크모드 대응도 동일 패턴(`@media (prefers-color-scheme: dark)` + `:root[data-theme='dark']`)으로 구현한다. (vehicle-fleet/settlement의 `style.css` 상단 구조를 그대로 따른다.)
- 다크모드 토글은 localStorage(`company-portal-theme` 등 이 앱 전용 키)에 사용자 선택을 저장.
- 반응형: 카드 그리드는 `grid-template-columns: repeat(auto-fill, minmax(...))` 방식으로 모바일에서 1열, 데스크톱에서 다열. 폼 입력은 모바일 터치 타깃 최소 44px 확보.

## 6. 작업 순서(체크리스트) — Build 단계용

1. `apps/company-portal/index.html` 뼈대 생성 — 헤더(제목+다크모드 토글), 허브 카드 섹션(3장의 카드 마크업), 진행중인 현장 섹션(목록 컨테이너 + "새 현장 등록" 버튼), 사용법 안내 박스, 폼(모달/패널) 마크업. `../settlement/index.html`, `../vehicle-fleet/index.html` 상대경로 링크 정확히 연결.
2. `apps/company-portal/style.css` 작성 — CSS 변수 재선언 + 다크모드 대응, 헤더/카드/그리드/폼/모달/배지/진행률 막대 스타일, 반응형 미디어쿼리. `index.html`에 링크 연결 후 다크모드 토글 없이도 정적으로 카드 3장 + 빈 현장 섹션이 팔레트에 맞게 보이는지 1차 확인.
3. `apps/company-portal/portal.js` 작성 — localStorage 키 상수, 현장 스키마 관련 헬퍼(생성/조회/수정/삭제), 시드 데이터 2건 + 최초 실행 시딩 로직, vehicle-fleet 읽기 전용 연동 헬퍼(`vehicle-fleet-vehicles` 안전 파싱 + 폴백), 단계 상수(착공전/기초/골조/마감/준공) 및 라벨/아이콘 매핑, 금액 포맷터(천단위 콤마 + "원").
4. `apps/company-portal/app.js` 작성(1차) — 진행중인 현장 목록 렌더링(카드: 현장명/위치/담당자/단계 배지/공정률 막대, 금액 미노출), 상세 펼침(금액 정보 + 투입 차량 표시) 렌더링. 시드 데이터로 목록/상세가 정상 표시되는지 브라우저에서 확인.
5. `app.js` 작성(2차) — 새 현장 등록 폼 열기/닫기, 필수값 검증, 저장(localStorage 반영) → 목록 즉시 갱신. 브라우저에서 신규 등록 후 새로고침해도 유지되는지 확인.
6. `app.js` 작성(3차) — 현장 수정(폼 프리필 후 저장), 삭제(confirm 후 제거) 구현 및 확인.
7. `app.js` 작성(4차) — 차량 선택 UI: `vehicle-fleet-vehicles` 조회 → 체크박스 리스트 렌더링(+빈 목록 안내 문구), 자유 입력 필드와 함께 저장/표시. vehicle-fleet 앱을 한 번 열어 차량을 등록해둔 브라우저와, 한 번도 안 연 브라우저 두 상황을 모두 확인.
8. `app.js` 다크모드 토글 로직 구현(localStorage 저장 + 최초 로드 시 반영) — 다른 앱들과 동일 패턴 재사용.
9. 모바일 뷰(좁은 화면) 확인 — 카드 그리드 1열 전환, 폼/모달 터치 조작, 버튼 크기 확인 및 필요 시 CSS 보정.
10. 최종 점검: 허브 카드 2개가 실제로 `apps/settlement/index.html`, `apps/vehicle-fleet/index.html`로 정상 이동하는지, 두 앱의 파일이 이번 작업으로 전혀 변경되지 않았는지(git diff 확인), 사용법 안내 문구가 화면에 실제로 보이는지 최종 확인 후 Build 서브에이전트 작업 종료.

---

## 7. 공개 랜딩 페이지 및 접근 제어 (개편)

> 이 장은 1~6장(허브 카드 + 진행중인 현장 관리, 이미 구현·검증 완료)을 **대체하지 않는다.** 1~6장의 데이터 스키마, localStorage 키, vehicle-fleet 연동, CRUD 로직은 전부 그대로 유지한 채, "화면 진입 시 무엇을 먼저 보여주고 무엇을 잠글지"에 대한 레이아웃/접근제어 계층을 추가하는 개편이다.

### 7.1 개편 개요

`apps/company-portal/`이 GitHub Pages로 공개 배포되면서(`https://younggee72.github.io/my-blog/apps/company-portal/index.html`), 이제 이 앱은 두 종류의 방문자를 동시에 상대해야 한다.

- **외부 방문자**: 회사를 모르는 사람이 링크를 통해 우연히 또는 홍보 목적으로 접속. 회사 소개(대외 홍보)만 보면 되고, 계약금액·기성고 등 내부 업무 데이터를 볼 이유도 권한도 없다.
- **내부 직원**: 기존에 구현된 업무 도구(허브 카드 3장)와 "진행중인 현장" 관리(민감한 금액 정보 포함)를 사용해야 한다.

따라서 화면을 **두 레이어**로 재편한다.

1. **공개 레이어**(기본으로 즉시 노출, 비밀번호 불필요): 대외 홍보용 랜딩 콘텐츠(히어로, 사업분야, 시공실적, 연락처).
2. **내부 레이어**(비밀번호 "7200" 입력 후에만 노출): 기존 허브 카드 섹션 + "진행중인 현장" 섹션 전체(1~6장 내용 그대로).

공개 레이어 안(또는 그 하단)에 "🔒 직원 전용 업무 시스템" 버튼을 두고, 클릭 시 비밀번호 입력 UI가 뜨며, 통과하면 내부 레이어가 화면에 나타난다.

### 7.2 공개 랜딩 콘텐츠 설계

공개 레이어는 아래 4개 섹션으로 구성한다. 실제 내용은 아직 없으므로, Build 단계에서 그대로 옮겨 쓸 수 있도록 **플레이스홀더 문구 초안**을 여기 확정한다. 각 섹션에는 눈에 띄는 배지/안내 박스로 "예시 텍스트이니 실제 내용으로 교체하세요"를 표시한다(다른 앱들의 시드데이터 안내 패턴 재사용 — 예: 노란/주황 계열 강조 박스에 ⚠️ 아이콘).

1. **히어로 섹션**
   - 회사명: "주식회사 지천건설" — `<h1>` 급으로 가장 크게.
   - 슬로건/한줄소개(플레이스홀더): "믿을 수 있는 시공, 지천건설이 만듭니다"
   - 그 아래 작은 배지: "⚠️ 예시 문구입니다. 실제 슬로건으로 교체하세요."

2. **사업분야 소개 카드** (3장, 그리드)
   - 토목 — 플레이스홀더 설명: "도로, 상하수도, 부지 조성 등 토목 공사 전반을 수행합니다. (예시 문구 — 실제 사업 내용으로 교체 필요)"
   - 건축 — 플레이스홀더 설명: "주거·상업 건축물의 신축 및 증축 공사를 진행합니다. (예시 문구 — 실제 사업 내용으로 교체 필요)"
   - 중장비 임대 — 플레이스홀더 설명: "포크레인, 덤프트럭 등 중장비를 임대·운영합니다. (예시 문구 — 실제 사업 내용으로 교체 필요)"

3. **시공실적/포트폴리오 섹션** (2~3장, 실제 사진 없이 자리만)
   - 각 카드: 회색/점선 placeholder 썸네일 영역 + "추후 시공 사례가 추가될 예정입니다" 문구. 실제 프로젝트명/사진은 아직 없으므로 채우지 않는다.

4. **연락처 섹션**
   - 주소(예시): "경기도 OO시 OO구 OO로 123"
   - 전화(예시): "031-000-0000"
   - 이메일(예시): "info@example.com"
   - 섹션 상단에 안내: "⚠️ 아래 연락처는 예시입니다. 실제 정보로 수정하세요."

레이아웃 순서: 헤더(회사명 고정 노출) → 히어로 → 사업분야 카드 → 시공실적 → 연락처 → "🔒 직원 전용 업무 시스템" 버튼 → (통과 시) 내부 레이어.

### 7.3 비밀번호 잠금 설계

**해시 방식**
- 평문 "7200"을 코드에 저장하지 않는다. 대신 SHA-256 해시값만 `portal.js`에 상수로 저장한다.
  ```
  PASSWORD_HASH = "3c5d8ca315f8c36d4cd4beecbc55b34c92a2d6eb1df730908df6f23dd2aa08f7"
  ```
  (Node.js `crypto`와 OpenSSL `dgst -sha256` 두 방식으로 `sha256("7200")`을 교차 계산해 위 값을 확인함.)
- 런타임에는 브라우저 내장 **Web Crypto API**(`crypto.subtle.digest('SHA-256', ...)`)로 사용자가 입력한 값을 같은 방식으로 해시한 뒤, 16진수 문자열로 변환해 `PASSWORD_HASH`와 비교한다. 외부 라이브러리 불필요.
- **트레이드오프 고지**: 이 방식은 "코드를 열어봐도 평문 비밀번호가 바로 보이지는 않는다"는 정도의 보호이며, 완전한 보안이 아니다. 해시가 클라이언트 JS(`portal.js`)에 그대로 노출되므로, 무차별 대입(브루트포스)이나 사전 공격에 대한 방어력은 없다(다만 "7200" 같은 4자리 숫자 비밀번호는 애초에 해시로 감춰도 크게 강하지 않음을 사용자도 인지). 이 잠금의 목적은 "높은 보안"이 아니라 "일반 방문자가 실수로/무심코 내부 데이터를 보는 것을 막는 가림막" 수준임을 spec.md와 화면 안내 문구 양쪽에 명시한다.
- `crypto.subtle`은 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작한다. GitHub Pages(HTTPS)와 로컬 정적 서버(`http://localhost:8000` 등, review.md에서 실제 사용한 방식) 모두 문제없이 동작하므로 Review 단계에서는 반드시 로컬 서버로 띄워 확인한다(파일을 브라우저에 직접 `file://`로 열면 일부 환경에서 `crypto.subtle`이 제한될 수 있음에 유의).

**잠금 해제 상태 저장 방식 — 결론: `sessionStorage` 채택**
- 검토한 두 옵션:
  - (a) `sessionStorage`: 탭/브라우저 세션이 끝나면(탭 닫기) 잠금 해제 상태가 사라짐. 매번 다시 열 때(새 탭 포함) 비밀번호를 다시 물어봄.
  - (b) `localStorage`: 한 번 통과하면 브라우저에 영구 저장, 다음에 열 때(새 탭이든 재부팅 후든) 다시 묻지 않음.
- **결론: (a) `sessionStorage`를 채택한다.** 이유:
  - 내부 레이어에는 계약금액 등 민감한 금액 정보가 들어있고, 이 앱은 공용/현장 사무실 PC에서도 열릴 가능성이 있다. `localStorage`로 영구 저장하면 그 PC를 나중에 쓰는 다른 사람(외부인 포함)이 새로고침만으로 내부 데이터를 그대로 볼 위험이 있다.
  - `sessionStorage`는 매번 다시 입력해야 하는 불편함이 있지만, 4자리 숫자 입력이라 부담이 크지 않고 "탭을 닫으면 다시 잠긴다"는 예측 가능한 동작이 안전 쪽에 더 부합한다.
  - sessionStorage 키: `company-portal-unlocked` (값 `'true'`). 같은 탭 안에서 새로고침해도 유지되고, 탭을 닫거나 새 탭에서 열면 다시 잠긴다는 점을 안내 문구에도 명시한다.
  - 부가 기능: 통과 후에도 "🔒 다시 잠그기" 버튼을 노출해, 사용자가 자리를 뜨기 전에 수동으로 즉시 잠글 수 있게 한다(공용 PC 대응 보완).

**UI 흐름**
1. 공개 레이어 하단에 "🔒 직원 전용 업무 시스템" 버튼 노출(항상 보임, 비밀번호 불필요 상태에서도 클릭 가능).
2. 클릭 → 비밀번호 입력 모달(기존 `modal-overlay`/`modal-panel` 패턴 재사용) 오픈. 입력 필드는 `inputmode="numeric"`(모바일 숫자 키패드 유도) + `maxlength="4"`을 갖는 `type="password"` 또는 `type="tel"` 필드 하나 + "확인"/"취소" 버튼.
3. 제출 → 입력값을 `crypto.subtle.digest`로 해시 → `PASSWORD_HASH`와 비교(비동기 처리이므로 제출 버튼은 처리 중 잠시 비활성화).
4. **성공**: 모달 닫힘 → `sessionStorage.setItem('company-portal-unlocked', 'true')` → 내부 레이어(`hidden` 속성 제거)가 화면에 나타남 → 잠금 버튼이 "🔓 잠금 해제됨 (다시 잠그기)"로 바뀜.
5. **실패**: 모달 안에 인라인 에러 메시지("비밀번호가 올바르지 않습니다") 표시, 입력 필드 포커스 유지, 재시도 가능(횟수 제한/잠금 없음 — 이 정도 보안 수준에 과한 장치이므로 생략).
6. 페이지 로드 시 `sessionStorage`에 이미 `company-portal-unlocked` 플래그가 있으면 비밀번호를 다시 묻지 않고 내부 레이어를 바로 노출한다(같은 탭 내 새로고침 대응).
7. "다시 잠그기" 버튼 클릭 → `sessionStorage.removeItem(...)` → 내부 레이어 다시 숨김 → 잠금 버튼 원상태로.

**보안 한계 고지 문구(화면 표시용, 모달 하단 또는 잠금 버튼 옆 작은 글씨)**
> "이 잠금은 완전한 보안 장치가 아닙니다. 브라우저 개발자도구 등으로 우회될 수 있는 클라이언트 수준의 가림막입니다."

동일한 취지의 문구를 상단 "사용법 안내" 박스(`guide-box`)에도 항목으로 추가한다.

### 7.4 파일 변경 범위

| 파일 | 변경 내용 |
|---|---|
| `index.html` | 기존 `<main class="container">` 내부를 두 구획으로 재편: (1) 새로 추가하는 `<section id="public-landing">`(히어로/사업분야/시공실적/연락처, 7.2절 내용) — 항상 노출. (2) 기존 허브 카드 섹션 + "진행중인 현장" 섹션 전체를 `<section id="internal-area" hidden>`로 감싸기(마크업 자체는 그대로 유지, wrapper와 `hidden` 속성만 추가). `public-landing`과 `internal-area` 사이에 잠금 버튼(`#unlock-btn`)과 비밀번호 입력 모달(`#password-modal-overlay`, 기존 `modal-overlay`/`modal-panel` 클래스 재사용) 마크업 추가. |
| `style.css` | 히어로/사업분야 카드/시공실적 placeholder 카드/연락처 섹션 스타일(반응형), "예시 문구" 안내 배지 스타일(⚠️ 강조), 잠금 버튼 및 비밀번호 모달 스타일(기존 모달 패턴 재사용해 최소 추가), 다크모드 대응 확인. 기존 CSS 변수 재선언부는 건드리지 않음. |
| `portal.js` | `PASSWORD_HASH` 상수 추가, `UNLOCK_SESSION_KEY = 'company-portal-unlocked'` 상수 추가, `sha256Hex(text)` 비동기 헬퍼(`crypto.subtle.digest` 래핑), `verifyPassword(input)`(비동기, boolean 반환), `isUnlocked()` / `setUnlocked()` / `lockAgain()` sessionStorage 헬퍼 함수 추가. 기존 상수/함수(SITES_KEY, VEHICLE_FLEET_VEHICLES_KEY, 시드 데이터 등)는 전혀 수정하지 않음. |
| `app.js` | 잠금 버튼 클릭 이벤트(모달 열기), 모달 폼 제출 이벤트(해시 비교 → 성공/실패 분기), "다시 잠그기" 이벤트, 페이지 로드 시 `isUnlocked()` 체크해 내부 레이어 자동 노출 로직 추가. `guide-box` 안내 목록에 잠금 관련 문구 1개 항목 추가. 기존 현장 CRUD/차량 선택/다크모드 로직은 전혀 수정하지 않음(내부 레이어가 `hidden` 해제된 이후에만 사용자가 접근하므로 기존 로직 변경 불필요). |

### 7.5 작업 순서(체크리스트) — Build 단계용 (이어서 11번부터)

11. `index.html`: `public-landing` 섹션 마크업 추가(히어로/사업분야 3카드/시공실적 2~3카드/연락처, 7.2절 문구 그대로 사용, 각 섹션에 "예시 문구" 안내 배지 포함). 기존 허브 카드 섹션 + 진행중인 현장 섹션 전체를 `<section id="internal-area" hidden>`로 감싸기(내용 변경 없이 wrapper만 추가). 잠금 버튼(`#unlock-btn`)과 비밀번호 입력 모달 마크업 추가.
12. `style.css`: `public-landing` 내 섹션들 스타일링 및 반응형(모바일 1열) 확인, 안내 배지 스타일, 잠금 버튼/모달 스타일 추가. 다크모드 토글로 전체(공개+잠금 UI) 팔레트 정상 전환되는지 확인.
13. `portal.js`: `PASSWORD_HASH`(위 7.3절 값), `UNLOCK_SESSION_KEY`, `sha256Hex`, `verifyPassword`, `isUnlocked`/`setUnlocked`/`lockAgain` 추가.
14. `app.js`: 잠금 버튼 → 모달 열기/닫기, 폼 제출 → `verifyPassword` 호출(비동기) → 성공 시 `internal-area`의 `hidden` 제거 + `setUnlocked()` + 버튼 라벨 "🔓 잠금 해제됨 (다시 잠그기)"로 전환, 실패 시 인라인 에러. 페이지 로드 직후 `isUnlocked()`이면 자동으로 내부 레이어 노출. "다시 잠그기" 클릭 시 `lockAgain()` + `internal-area` 다시 `hidden` 처리.
15. `guide-box` 안내 목록에 "🔒 직원 전용 업무 시스템은 비밀번호로 잠겨 있으며, 이는 완전한 보안이 아닌 클라이언트 수준의 가림막입니다" 항목 추가.
16. 브라우저 확인(정적 서버로 구동, `file://` 직접 열기 금지): (a) 처음 진입 시 공개 랜딩만 보이고 내부 레이어는 DOM상 `hidden`인지, (b) 잘못된 비밀번호 입력 시 에러 표시 및 미통과, (c) "7200" 입력 시 내부 레이어 노출 및 기존 허브 카드/현장 목록이 1~6장과 동일하게 정상 동작하는지, (d) 같은 탭에서 새로고침 시 다시 묻지 않는지, (e) 새 탭에서 같은 URL을 열면 다시 잠기는지(sessionStorage 특성), (f) "다시 잠그기" 클릭 시 즉시 재잠금되는지, (g) 모바일 뷰포트에서 비밀번호 입력 시 숫자 키패드가 뜨는지.
17. 회귀 확인: 1~6장에서 이미 구현된 현장 CRUD, vehicle-fleet 읽기 전용 연동, 금액 정보 상세 노출 제어, 다크모드가 이번 개편으로 전혀 깨지지 않았는지 재확인. `git diff`로 `apps/company-portal/` 외 파일(다른 앱, 블로그 본체)이 이번 작업으로 전혀 변경되지 않았는지 최종 확인 후 Build 서브에이전트 작업 종료.

---

## 8. 업무자료실(Firebase Storage 연동)

> 이 장은 1~7장(허브 카드 + 진행중인 현장 관리 + 공개 랜딩/비밀번호 잠금, 이미 구현·검증 완료)을 **대체하지 않는다.** 기존 로직/데이터/보안 구조는 전부 그대로 유지한 채, 내부 레이어의 "업무 도구" 허브 카드 3장 중 비활성 placeholder였던 "기타 업무 도구" 카드를 실제 기능("업무자료")으로 교체하는 신규 기능 추가다.

### 8.1 개요

사용자 요청: "기타업무도구 란은 업무자료란으로 수정하고 업무자료방에 들어가면, 1.공사자료 2.안전자료 를 만들어서 각각방에 PDF파일 CAD파일 엑셀파일등을 올릴수 있도록 만들어줘".

이 기능은 **여러 직원이 같은 파일을 실제로 공유**해야 하는 용도(공사 도면, 안전 서류 등)이므로, 브라우저 로컬 저장(localStorage)이 아니라 **실제 클라우드 저장소**가 필요하다. 이를 위해 사용자가 별도로 Firebase 프로젝트(`jicheon-construction`)를 생성하고 Cloud Storage를 활성화했으며, 아래 클라이언트 설정값과 보안 규칙이 이미 준비되어 있다. company-portal은 이 값을 그대로 사용해 Firebase Storage 클라이언트 SDK로 파일 업로드/목록조회/다운로드/삭제 기능을 구현한다. 이 기능만 예외적으로 CDN(Firebase JS SDK, ES 모듈)을 사용한다 — 프로젝트 규칙상 CDN은 허용되어 있다.

### 8.2 파일 구조

```
apps/company-portal/
├── materials.html    # (신규) 업무자료실 페이지 — 공사자료/안전자료 두 개의 방(탭 또는 섹션)
├── materials.css      # (신규) 업무자료실 전용 스타일. style.css의 CSS 변수(:root 재선언부)와
│                        동일한 값을 그대로 다시 선언해 팔레트/다크모드 일관성 유지
│                        (style.css에 이어 쓰지 않고 별도 파일로 분리 — 이유는 8.5절 참고)
├── materials.js       # (신규) Firebase 초기화(ES 모듈 CDN import) + 업로드/목록/다운로드/삭제 로직 + 렌더링
├── index.html          # (수정) 허브 카드 3번째 항목: "기타 업무 도구"(비활성) → "업무자료"(활성, materials.html 링크)로 교체
├── style.css            # (변경 없음)
├── portal.js             # (변경 없음)
└── app.js                 # (변경 없음)
```

**파일 구조 판단 근거**: `materials.js`는 Firebase SDK를 ES 모듈로 import해야 하므로 `<script type="module">`로 로드되는데, 기존 `app.js`/`portal.js`는 일반 스크립트(non-module)이고 서로 다른 페이지(index.html vs materials.html)에서 쓰인다. 페이지를 완전히 분리했으므로 CSS도 같은 파일(style.css)에 이어 쓰기보다 `materials.css`로 분리하는 편이 "이 페이지가 무엇을 로드하는지" 명확하고, 기존 style.css를 건드릴 위험(회귀)도 없다. 대신 CSS 변수 값과 다크모드 미디어쿼리 구조는 style.css와 동일하게 맞춘다.

### 8.3 핵심 로직 설계

**Firebase 초기화 (`materials.js` 상단, ES 모듈 CDN import)**

```js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage, ref, uploadBytesResumable, listAll,
  getMetadata, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdyXmaN_rgxG_eCFA8jnuzvQabL8thLFk",
  authDomain: "jicheon-construction.firebaseapp.com",
  projectId: "jicheon-construction",
  storageBucket: "jicheon-construction.firebasestorage.app",
  messagingSenderId: "79554524630",
  appId: "1:79554524630:web:67a2588607f85984c82077",
  measurementId: "G-H7P1VFC43Q"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
```

**폴더 경로 규칙**: 같은 버킷 안에서 폴더 경로로 두 방을 구분한다.
- 공사자료 → `construction/`
- 안전자료 → `safety/`

**파일명 충돌 방지**: 업로드 시 원본 파일명 그대로 저장하지 않고, `타임스탬프_원본파일명` 형태로 접두사를 붙인다(예: `1735500000000_배관도면.dwg`). 목록 표시 시에는 접두사를 제거하고 원본 파일명만 사용자에게 보여준다(정규식으로 앞의 `숫자_` 패턴만 분리).

```js
function buildStoragePath(room, file) {
  const prefixed = `${Date.now()}_${file.name}`;
  return `${room}/${prefixed}`; // room: 'construction' | 'safety'
}
function displayName(storagePath) {
  const filename = storagePath.split('/').pop();
  return filename.replace(/^\d+_/, '');
}
```

**클라이언트 사이드 20MB 검증** (업로드 전 반드시 실행, 통과 못하면 `uploadBytesResumable` 호출 자체를 막음):

```js
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
function validateFileSize(file) {
  if (file.size > MAX_FILE_SIZE) {
    showError(`"${file.name}" 파일이 20MB를 초과합니다. (${formatBytes(file.size)}) 20MB 이하 파일만 업로드할 수 있습니다.`);
    return false;
  }
  return true;
}
```

**업로드 함수 (의사코드)**

```js
async function uploadFile(room, file) {
  if (!validateFileSize(file)) return;
  const path = buildStoragePath(room, file);
  const fileRef = ref(storage, path);
  const task = uploadBytesResumable(fileRef, file);

  showProgressUI(room, file.name, 0);
  task.on('state_changed',
    snapshot => {
      const pct = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
      updateProgressUI(room, file.name, pct);
    },
    error => showError(`업로드 실패: ${error.message}`),
    async () => {
      hideProgressUI(room, file.name);
      await refreshFileList(room); // 완료 후 목록 자동 갱신
    }
  );
}
```

**목록조회 함수 (의사코드)** — 별도 DB(Firestore) 없이 Storage API만으로 구현. 이 프로젝트는 Storage만 설정했고 Firestore는 사용하지 않는다.

```js
async function refreshFileList(room) {
  const folderRef = ref(storage, room); // 'construction' 또는 'safety'
  const result = await listAll(folderRef);

  const items = await Promise.all(result.items.map(async (itemRef) => {
    const [meta, url] = await Promise.all([
      getMetadata(itemRef),
      getDownloadURL(itemRef)
    ]);
    return {
      path: itemRef.fullPath,
      name: displayName(itemRef.name),
      size: meta.size,               // bytes
      uploadedAt: meta.timeCreated,  // ISO string
      url
    };
  }));

  items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)); // 최신순
  renderFileList(room, items);
}
```

**다운로드/삭제 함수 (의사코드)**

```js
function downloadFile(item) {
  window.open(item.url, '_blank'); // getDownloadURL 결과를 새 탭에서 열기
}

async function deleteFile(room, item) {
  if (!confirm(`"${item.name}" 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
  const fileRef = ref(storage, item.path);
  await deleteObject(fileRef);
  await refreshFileList(room);
}
```

**용량 포맷터** (기존 앱들의 금액 포맷터와 동일한 패턴, KB/MB 단위 자동 전환):

```js
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

### 8.4 보안 현황과 한계

현재 배포된 Storage 보안 규칙(Firebase 콘솔에서 이미 게시됨):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

즉 지금은 **누구나(로그인 없이) 읽기/쓰기(업로드/삭제 포함)가 가능한 완전 개방 상태**다. 사용자가 Firebase 콘솔 규칙 편집기에서 여러 번 입력 오류를 겪어, 우선 동작을 확인할 수 있는 가장 단순한 규칙으로 게시해 둔 상태다.

- **이것은 진짜 보안이 아니다.** `materials.html`의 URL(및 그 안에서 호출하는 Storage 버킷)을 아는 사람은 누구나 업로드·다운로드·삭제가 가능하다.
- 이는 7장에서 이미 채택한 트레이드오프와 같은 맥락이다 — 회사 홈페이지 비밀번호 잠금("7200")도 "완전한 보안"이 아니라 "일반 방문자가 실수로/무심코 보는 것을 막는 가림막" 수준으로 설계했었다. `materials.html`도 (a) `internal-area`(비밀번호 통과 후에만 보이는 내부 레이어) 안에서만 링크로 연결되므로 일반 외부 방문자는 애초에 도달하기 어렵지만, (b) URL을 직접 아는 사람이라면 비밀번호 우회 여부와 무관하게 Storage 자체는 열려 있다는 한계가 남는다.
- 클라이언트 쪽에서 보완하는 것: 파일 크기 20MB 초과 시 업로드 자체를 막아(8.3절 `validateFileSize`), 실수로 매우 큰 파일을 올려 스토리지 용량/비용이 낭비되는 사고 정도는 예방한다. 이것도 "보안"이 아니라 "실수 방지" 목적임을 명확히 한다.
- 이 현황과 한계는 화면에도(8.6절 안내 박스) 동일하게 고지한다 — 사용자가 이후 Firebase 콘솔에서 Authentication 등을 붙여 규칙을 강화하기 전까지는 계속 유효한 제약이다.

### 8.5 UI/디자인

**허브 카드 변경** (`index.html`, `internal-area` > `hub-grid` 세 번째 카드):
- 기존: `<div class="hub-card hub-card-disabled" aria-disabled="true">` (클릭 불가 placeholder, 아이콘 🧩, 제목 "기타 업무 도구", 설명 "추후 추가 예정입니다.")
- 변경 후: 다른 두 카드(현장정산서, 법인차량관리)와 동일하게 `<a class="hub-card" href="materials.html">`로 바꾸고, 아이콘은 📁(또는 🗂️), 제목 "업무자료", 설명 "공사자료·안전자료 파일을 업로드하고 공유합니다."로 교체. `hub-card-disabled` 클래스 제거.

**`materials.html` 페이지 레이아웃** (위→아래):
1. 헤더: 페이지 제목("업무자료실") + "← 포털로 돌아가기" 링크(`index.html`) + 다크모드 토글(기존 패턴 재사용).
2. 사용법 안내 박스(`guide-box` 패턴 재사용, 8.6절 문구).
3. 방 전환 탭 또는 섹션: "1. 공사자료" / "2. 안전자료" 두 개를 탭 버튼(`role="tab"`)으로 전환하거나, 스크롤로 이어지는 두 섹션으로 배치(Build 단계 재량이되 탭 방식을 우선 권장 — 방마다 독립된 파일 목록이 길어질 수 있어 한 화면에 두 방을 동시에 쌓아두면 스크롤이 길어짐).
4. 각 방 내부:
   - 업로드 영역: `<input type="file" accept=".pdf,.dwg,.dxf,.xls,.xlsx">` + "업로드" 버튼. 업로드 중에는 파일명 옆에 진행률(%) 텍스트 또는 진행 바 표시.
   - 파일 목록: 기존 `item-card` 패턴을 재사용한 카드형 리스트. 각 카드에 파일명, 용량(`formatBytes`), 업로드 일시(`toLocaleString('ko-KR')`), "다운로드"/"삭제" 버튼 2개.
   - 목록이 비어 있으면 "아직 업로드된 파일이 없습니다." 안내.

**스타일 원칙** (`materials.css`): `style.css`와 동일한 CSS 변수 이름·값(`--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`, `--font-body`, `--font-mono`)을 `:root`에 재선언, 다크모드도 동일 패턴(`@media (prefers-color-scheme: dark)` + `:root[data-theme='dark']`)으로 대응. 탭 UI, 업로드 영역, 진행률 바, 파일 카드 스타일을 추가. 반응형: 좁은 화면에서 파일 카드 내부 버튼 2개가 줄바꿈되어도 터치 타깃 44px 이상 유지, 탭은 모바일에서도 가로로 나열 가능한 크기로.

### 8.6 사용법 안내 및 보안 고지 문구 (화면 표시용)

`materials.html`의 `guide-box`에 다음 항목을 포함한다:
- "이 페이지에 업로드한 파일은 브라우저 로컬 저장이 아니라 **모든 방문자가 접근 가능한 공유 저장소(Firebase Storage)**에 저장되며, 같은 링크로 접속하는 모든 직원이 함께 봅니다."
- "이 링크(URL)를 아는 사람은 누구나 업로드·다운로드·삭제가 가능한 수준의 보안입니다 — 회사 홈페이지의 비밀번호 잠금(7200)과 같은 성격의 트레이드오프로, 완전한 보안 장치가 아닙니다."
- "파일 1개당 최대 20MB까지 업로드할 수 있습니다."

### 8.7 작업 순서(체크리스트) — Build 단계용 (이어서 18번부터)

18. `index.html`: `hub-grid`의 세 번째 카드(`hub-card-disabled`, "기타 업무 도구")를 `<a class="hub-card" href="materials.html">`(아이콘 📁, 제목 "업무자료", 설명 "공사자료·안전자료 파일을 업로드하고 공유합니다.")로 교체. `settlement`/`vehicle-fleet` 카드와 마크업 패턴 동일하게 맞춤.
19. `materials.html` 뼈대 생성: 헤더(제목+뒤로가기 링크+다크모드 토글), `guide-box`(8.6절 문구), 공사자료/안전자료 두 방의 탭 또는 섹션 마크업(업로드 영역 + 파일 목록 컨테이너), `<script type="module" src="materials.js"></script>` 연결.
20. `materials.css` 작성: CSS 변수 재선언 + 다크모드 대응(style.css와 동일 값), 헤더/가이드박스/탭/업로드/진행바/파일카드 스타일, 반응형. `materials.html`에 링크 연결 후 다크모드 없이도 정적 레이아웃이 팔레트에 맞게 보이는지 1차 확인.
21. `materials.js` 작성(1차): Firebase 초기화(ES 모듈 CDN import, 8.3절 설정값 그대로), `storage` 인스턴스 생성까지 콘솔 에러 없이 로드되는지 확인.
22. `materials.js` 작성(2차): `refreshFileList(room)`(listAll+getMetadata+getDownloadURL) 및 `renderFileList` 구현, 페이지 로드 시 두 방(`construction`, `safety`) 목록을 각각 불러와 렌더링. 최초에는 빈 버킷이므로 "업로드된 파일이 없습니다" 상태가 정상 표시되는지 확인.
23. `materials.js` 작성(3차): `uploadFile` 구현(20MB 검증 → `uploadBytesResumable` → 진행률 UI → 완료 시 `refreshFileList` 재호출). 실제로 PDF/엑셀 파일 1개씩 업로드해 목록에 반영되는지, 20MB 초과 파일 시도 시 업로드가 차단되고 안내 메시지가 뜨는지 확인.
24. `materials.js` 작성(4차): `downloadFile`(새 탭 열기), `deleteFile`(confirm 후 `deleteObject` + 목록 갱신) 구현 및 확인.
25. 탭 전환(공사자료 ↔ 안전자료) 동작 확인 — 각 방의 파일 목록이 서로 섞이지 않고 독립적으로 표시/업로드/삭제되는지(`construction/`, `safety/` 경로 분리가 실제로 지켜지는지) 확인.
26. 다크모드·모바일 반응형 확인(다른 화면들과 동일 패턴).
27. 최종 점검: (a) `index.html`의 업무자료 카드 클릭 시 `materials.html`로 정상 이동하는지, (b) 8.4절 보안 고지 문구와 20MB 제한 안내가 실제 화면에 보이는지, (c) `apps/company-portal/` 외 파일(다른 앱, 블로그 본체)이 이번 작업으로 전혀 변경되지 않았는지 `git diff`로 확인 후 Build 서브에이전트 작업 종료.
