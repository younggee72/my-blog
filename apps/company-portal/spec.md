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
