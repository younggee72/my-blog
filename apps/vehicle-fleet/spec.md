# 법인차량 관리 프로그램 구현 계획 (spec.md)

## 1. 개요

회사 보유 법인차량(포터 6대, 2.5톤 덤프트럭 1대, 포크레인 1대, 승용차 1대 — 총 9대)을 대상으로, **① 차량 기본정보 등록·관리, ② 정기검사·보험 만기 관리, ③ 엔진오일 등 소모품 교환주기 관리**를 한 화면에서 처리하는 정적 웹앱이다. 서버/DB 없이 브라우저 **localStorage**에만 데이터를 저장하는 개인/소규모 사업장용 관리 도구이며, 담당자가 매일 열어 "오늘 챙겨야 할 차량이 있는지"를 한눈에 확인하는 **대시보드**와, 차량 한 대를 클릭해 들어가 검사·보험·소모품 항목을 등록/수정하는 **차량 상세 화면**으로 구성된다.

포터/덤프/승용차는 자동차관리법상 **자동차 정기검사** 대상이고, 포크레인(굴착기)은 도로 주행이 없는 **건설기계**로 **건설기계 정기검사** 대상이라는 점이 다르므로, 차종 분류에 따라 검사 항목의 명칭과 기본 주기를 다르게 안내한다. 소모품도 차종에 따라 관리 포인트가 다르다(포크레인은 유압오일이 핵심, 나머지는 엔진오일·미션오일이 핵심). 향후 차량 대수·차종이 바뀔 수 있음을 전제로, 차종·항목 목록을 상수 배열로 분리해 코드 한 곳만 고치면 전체 UI에 반영되도록 설계한다.

## 2. 파일 구조

```
/apps/vehicle-fleet/
  index.html    진입점. 헤더(제목+다크모드 토글), 사용법 안내, 대시보드/차량상세 화면 컨테이너,
                차량 등록 폼, 검사·소모품 항목 등록 폼, 내보내기/가져오기 버튼 마크업, css/js 로드
  style.css     레이아웃, 카드/폼/모달/상태배지 스타일, 다크모드, 반응형 (색상은 전부 사이트 CSS 변수 var() 참조)
  fleet.js      차종/검사종류/소모품종류 상수 정의, 데이터 스키마, localStorage 저장/조회,
                다음 예정일·임박/경과 계산 순수 함수, 시드 데이터(실제 9대 목업)
  app.js        DOM 렌더링(대시보드, 차량상세), 폼 입력 처리/검증, 화면 전환,
                내보내기/가져오기, 다크모드 토글 이벤트 바인딩
```

- 이미지 리소스는 사용하지 않는다(차종 아이콘은 이모지로 대체: 🚚 포터, 🚛 덤프, 🚜 포크레인, 🚗 승용차 등).
- 외부 CDN 라이브러리는 사용하지 않는다. 폼/목록/날짜계산 수준은 순수 JS로 충분하다.
- `fleet.js`(데이터/로직)와 `app.js`(화면 렌더링/이벤트)를 분리해 Build 단계에서 각각 독립적으로(콘솔에서 함수 단위로) 검증할 수 있게 한다.

## 3. 핵심 로직 설계

### 3.1 차종 목록 정의 방식

`fleet.js` 상단에 배열 상수로 정의해 차종 추가/변경이 쉽도록 한다.

```js
const VEHICLE_TYPES = [
  { id: 'porter',    label: '포터(트럭)', icon: '🚚', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 12,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
  { id: 'dump',      label: '2.5톤 덤프트럭', icon: '🚛', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 6,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
  { id: 'excavator', label: '포크레인(굴착기)', icon: '🚜', isRoadVehicle: false,
    inspectionLabel: '건설기계 정기검사', defaultInspectionCycleMonths: 12,
    defaultConsumables: ['engine_oil', 'hydraulic_oil', 'oil_filter'] },
  { id: 'car',       label: '승용차', icon: '🚗', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 24,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
];
```

- `isRoadVehicle`로 자동차검사/건설기계검사 문구를 가르고, `inspectionLabel`을 차량 등록·상세 화면에 그대로 노출한다. `defaultInspectionCycleMonths`는 화물차 6개월(사업용은 실제로 더 짧을 수 있어 등록 시 사용자가 자유롭게 수정 가능한 기본값일 뿐임을 안내 문구에 명시), 승용차(비사업용) 신차 최초 4년 후 2년 주기 등 실제 제도와 차이가 있을 수 있음을 5.5절 안내에서 "기본값이며 실제 통지서 기준으로 직접 수정하라"고 고지한다.
- `defaultConsumables`는 차량 신규 등록 시 소모품 항목을 자동으로 깔아주는 목록이며, 등록 후에도 항목을 자유롭게 추가/삭제할 수 있어 차종별 기본값이 강제되지는 않는다.
- 보험 항목은 차종과 무관하게 모든 차량에 공통으로 등록 가능(자동차보험 또는 건설기계보험 1개 이상)하도록 별도 카테고리로 둔다(3.3절).

```js
const CONSUMABLE_TYPES = [
  { id: 'engine_oil',   label: '엔진오일',   unit: 'km', defaultCycleMonths: 6,  defaultCycleKm: 10000 },
  { id: 'mission_oil',  label: '미션오일(변속기오일)', unit: 'km', defaultCycleMonths: 24, defaultCycleKm: 40000 },
  { id: 'hydraulic_oil',label: '유압오일',   unit: 'km', defaultCycleMonths: 12, defaultCycleKm: null },
  { id: 'air_filter',   label: '에어필터',   unit: 'km', defaultCycleMonths: 12, defaultCycleKm: 20000 },
  { id: 'oil_filter',   label: '오일필터',   unit: 'km', defaultCycleMonths: 6,  defaultCycleKm: 10000 },
  { id: 'tire',         label: '타이어',     unit: 'km', defaultCycleMonths: 36, defaultCycleKm: 50000 },
  { id: 'etc',          label: '기타 소모품', unit: 'km', defaultCycleMonths: null, defaultCycleKm: null },
];
```

- 포크레인처럼 주행거리(km) 개념이 없는 중장비는 `unit`을 등록 화면에서 `km` 대신 `시간(가동시간)` 또는 `월(기간)` 기준으로 바꿔 입력할 수 있게 하되, 이번 범위에서는 단순화를 위해 **날짜(개월) 기준 계산을 기본**으로 하고 km 입력은 선택 사항으로 둔다(3.4절 계산 로직 참고). `etc` 항목으로 목록에 없는 소모품(예: 배터리, 브레이크패드)도 자유 입력 가능하게 한다.

### 3.2 데이터 스키마

**차량(Vehicle)**
```js
{
  id: string,            // crypto.randomUUID() 또는 타임스탬프+난수
  plateNumber: string,   // 차량번호(번호판), 필수
  vehicleType: string,   // VEHICLE_TYPES의 id
  modelName: string,     // 모델명(예: "포터2 초장축"), 선택
  driver: string,        // 담당자/운전자, 선택
  note: string,          // 비고, 선택
  currentOdometer: number, // 현재 주행거리(km), 선택 — km 기준 소모품 계산에 사용
  createdAt: string,     // ISO 날짜, 등록 시각
}
```

**검사/보험 일정(ScheduleItem)** — 자동차/건설기계 정기검사, 보험을 같은 구조로 통합 관리
```js
{
  id: string,
  vehicleId: string,      // 소속 차량 id
  category: string,       // 'inspection'(정기검사) | 'insurance'(보험)
  label: string,          // 화면 표시명(등록 시 vehicleType의 inspectionLabel 자동 채움, 보험은 '자동차보험'/'건설기계보험' 중 선택 또는 자유입력)
  lastDate: string,       // 마지막 검사일 또는 마지막 가입(갱신)일 (YYYY-MM-DD)
  cycleMonths: number,    // 주기(개월) — 마지막일 + 주기로 다음 예정일 자동계산할 때 사용
  nextDateOverride: string | null, // 다음 예정일을 직접 입력했다면 이 값을 우선 사용(null이면 자동계산)
  note: string,           // 선택
}
```

**소모품 교환 항목(ConsumableItem)**
```js
{
  id: string,
  vehicleId: string,
  itemType: string,        // CONSUMABLE_TYPES의 id
  customLabel: string,     // itemType이 'etc'일 때 사용자가 직접 입력하는 이름
  lastChangeDate: string,  // 마지막 교환일 (YYYY-MM-DD), 필수
  lastChangeOdometer: number | null, // 마지막 교환 시 주행거리(km), 선택
  cycleMonths: number | null,  // 교환주기(개월), 둘 중 하나 이상 필수
  cycleKm: number | null,      // 교환주기(km), 둘 중 하나 이상 필수
  note: string,             // 선택
}
```

- 검사/보험/소모품 모두 **한 차량에 여러 건 등록 가능**한 1:N 구조(예: 검사 이력을 새로 등록하면 이전 건은 "지난 이력"으로 표시하거나 최신 1건만 유지 — 3.3절에서 "최신 1건만 유지" 방식으로 단순화하기로 결정).
- 필수 필드: 차량 — `plateNumber`, `vehicleType`. 일정 — `category`, `label`, `lastDate`, `cycleMonths`(또는 `nextDateOverride` 중 하나). 소모품 — `itemType`, `lastChangeDate`, (`cycleMonths` 또는 `cycleKm` 중 하나 이상).

### 3.3 다음 예정일 계산 및 최신 1건 유지 방식

- **단순화 결정**: 검사/보험/소모품 항목은 "이력 누적"이 아니라 **차량당 카테고리(또는 소모품 종류)별 최신 상태 1건만 관리**한다. 즉, 이미 등록된 "엔진오일" 항목이 있는 차량에서 오일을 교환하면 새 항목을 추가하는 게 아니라 기존 항목의 `lastChangeDate`/`lastChangeOdometer`를 "교환 완료 처리" 액션으로 갱신한다(수정 폼과 동일 UI 재사용). 이렇게 하면 데이터가 무한히 늘어나지 않고, 대시보드 계산 로직도 차량×항목 조합당 최신값 하나만 보면 되므로 단순해진다. 과거 이력이 필요하면 향후 확장으로 남긴다(6장 이후 범위 밖으로 명시).
- 검사/보험 `category`별로 한 차량에 항목을 여러 개(예: 자동차보험 + 화물자동차보험 등) 등록할 수는 있으나, 같은 `label`을 중복 등록하려 하면 "이미 등록된 항목입니다. 수정하시겠습니까?" 안내로 수정 폼을 유도한다.

### 3.4 다음 예정일 / 임박·경과 판정 계산 로직

`fleet.js`에 순수 함수로 구현해 대시보드·상세화면에서 공통으로 재사용한다.

```js
function getNextDueDate(item) {
  // item: ScheduleItem 또는 ConsumableItem (날짜 기준)
  if (item.nextDateOverride) return item.nextDateOverride;
  if (!item.lastDate && !item.lastChangeDate) return null;
  const base = new Date(item.lastDate || item.lastChangeDate);
  const months = item.cycleMonths;
  if (!months) return null;
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
}

function getKmRemaining(item, currentOdometer) {
  // 소모품 전용: km 기준 잔여 거리 계산
  if (!item.cycleKm || item.lastChangeOdometer == null || currentOdometer == null) return null;
  return (item.lastChangeOdometer + item.cycleKm) - currentOdometer;
}

function getItemStatus(item, currentOdometer, today = new Date()) {
  // 반환값: 'overdue'(경과) | 'due-soon'(임박, 기본 30일/1000km 이내) | 'ok'(정상) | 'unknown'(계산불가)
  const dueDate = getNextDueDate(item);
  const kmRemaining = getKmRemaining(item, currentOdometer);
  const results = [];

  if (dueDate) {
    const daysLeft = Math.floor((new Date(dueDate) - today) / 86400000);
    results.push(daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 'due-soon' : 'ok');
  }
  if (kmRemaining != null) {
    results.push(kmRemaining < 0 ? 'overdue' : kmRemaining <= 1000 ? 'due-soon' : 'ok');
  }
  if (results.length === 0) return 'unknown';
  // 날짜 기준과 km 기준 중 더 급한 쪽(overdue > due-soon > ok)을 최종 상태로 채택
  if (results.includes('overdue')) return 'overdue';
  if (results.includes('due-soon')) return 'due-soon';
  return 'ok';
}
```

- 임박 기준(30일/1000km)은 `fleet.js` 상단 상수(`DUE_SOON_DAYS = 30`, `DUE_SOON_KM = 1000`)로 분리해 추후 조정이 쉽게 한다.
- `currentOdometer`는 차량 객체의 값을 그대로 전달하며, 값이 없으면 km 기준 판정은 생략하고 날짜 기준만으로 판정한다(포크레인 등 주행거리 미입력 차량 고려).
- 대시보드 요약 배지(전체 몇 건 경과/임박)는 이 함수를 모든 차량 × 모든 항목에 돌려 `overdue`/`due-soon` 개수를 집계하는 순수 함수 `getFleetSummary(vehicles, schedules, consumables)`로 별도 구현한다.

### 3.5 localStorage 저장 방식

- Key 3종: `vehicle-fleet-vehicles`(차량 배열), `vehicle-fleet-schedules`(검사/보험 배열), `vehicle-fleet-consumables`(소모품 배열) — 각각 JSON 문자열로 저장.
- 초기화 여부 플래그 `vehicle-fleet-initialized` 키로 최초 실행 여부를 구분해, 최초 1회만 시드 데이터를 채우고 이후 사용자가 전부 삭제해도 다시 채우지 않는다.
- 저장/조회 함수: `loadVehicles/saveVehicles`, `loadSchedules/saveSchedules`, `loadConsumables/saveConsumables` — 조회 시 JSON 파싱 실패하면 콘솔 경고 후 빈 배열로 폴백.
- 등록/수정/삭제는 해당 배열 전체를 다시 저장하는 단순 방식(차량 9대, 항목 수십 건 수준이라 성능 문제 없음).
- 차량 삭제 시 해당 `vehicleId`를 참조하는 schedules/consumables 항목도 함께 삭제(cascade)한다.

### 3.6 초기 샘플 데이터 구성안

실제 보유 대수(포터 6, 덤프 1, 포크레인 1, 승용차 1 = 9대)에 맞춰 시드 데이터를 구성하되, 차량번호 등 식별 정보는 **가상의 예시 값**(예: "포터1", "12가 3456" 형식의 더미 번호판)으로 채우고, 처음 실행 시 화면 안내 문구로 "예시 데이터이므로 실제 차량번호로 수정해서 사용하라"고 고지한다.

- 포터 6대: `plateNumber`를 "12가 1001"~"12가 1006" 형태로 순번 부여, 각각 담당자 예시("김OO" 등 자리표시자)와 서로 다른 마지막 검사일·오일 교환일을 분산 배치해 대시보드에서 정상/임박/경과 상태가 골고루 섞여 보이도록 한다(예: 1대는 검사 만기 임박, 1대는 엔진오일 경과 등).
- 덤프트럭 1대, 포크레인 1대, 승용차 1대는 각 차종의 `defaultConsumables`에 맞춰 소모품 항목(포크레인은 유압오일 포함)과 검사(포크레인은 건설기계 정기검사) + 보험 1건을 등록해둔다.
- 9대 전체에 최소 1개 이상의 `overdue` 또는 `due-soon` 항목이 나오도록 날짜를 역산해서 넣어, 앱을 처음 열었을 때 대시보드 요약 배지가 "0건"으로만 나오지 않고 실제 기능을 시연할 수 있게 한다.
- 시드 데이터는 `fleet.js` 하단에 `SEED_VEHICLES`, `SEED_SCHEDULES`, `SEED_CONSUMABLES` 상수로 분리해 가독성을 확보한다.

### 3.7 데이터 내보내기/가져오기(JSON)

- 계획 판단: 이 앱은 회사 내부에서 담당자가 PC/스마트폰 등 **여러 기기에서 같은 데이터를 봐야 할 가능성**이 있고, localStorage는 기기·브라우저 간 동기화가 안 되므로 **내보내기/가져오기(JSON) 기능을 포함하기로 결정**한다(construction-jobs 앱과 동일 패턴 재사용).
- 내보내기: vehicles/schedules/consumables 3개 배열을 하나의 JSON 객체(`{ vehicles, schedules, consumables, exportedAt }`)로 묶어 `Blob` + `<a download>`로 파일 다운로드(파일명 예: `vehicle-fleet-backup-YYYYMMDD.json`).
- 가져오기: `<input type="file">`로 JSON 선택 → 스키마 검증(3개 배열 키 존재 확인) → "기존 데이터를 덮어쓸까요, 병합할까요" 확인창 → 저장 후 화면 재렌더링. 형식이 잘못된 파일이면 에러 안내 후 무시.

### 3.8 알림(웹훅) 설정 및 발송 로직

이번 추가 요구사항: 검사·보험·소모품 주기가 다가오면 지정된 관리자에게 메시지를 보낸다. 이 프로젝트는 서버/크론이 없는 정적 사이트이므로 "매일 정해진 시각에 자동 발송"은 불가능하며, **관리자가 앱을 여는 시점마다 그때 기준으로 임박/경과 항목을 계산해 웹훅으로 전송**하는 방식으로 구현한다(사용자와 상의해 확정된 방식).

**알림 설정 데이터**
```js
{
  webhookUrl: string,   // 관리자가 발급받아 붙여넣는 웹훅 엔드포인트 URL (슬랙/디스코드/카카오톡 나에게 보내기·문자 API 등)
  enabled: boolean,     // 알림 켜기/끄기
}
```
- localStorage key: `vehicle-fleet-notify-config` (JSON 문자열 저장). 저장/조회 함수 `loadNotifyConfig`/`saveNotifyConfig`를 `fleet.js`에 둔다.
- **웹훅 URL은 코드에 하드코딩하지 않는다** — 반드시 관리자가 설정 화면에서 직접 입력해 localStorage에 저장하는 값만 사용한다(보안 요구사항).

**중복 발송 방지**
- localStorage key: `vehicle-fleet-notify-log`. 값 형태: `{ [itemKey]: 'YYYY-MM-DD' }` (마지막으로 알림에 포함되어 전송된 날짜).
- `itemKey`는 항목 종류와 id를 조합해 고유하게 만든다(예: `schedule:${scheduleItem.id}`, `consumable:${consumableItem.id}`).
- 오늘 날짜(`YYYY-MM-DD`)와 로그에 기록된 날짜가 같은 항목은 이번 전송 대상에서 제외해, 같은 날 앱을 여러 번 열어도 같은 항목으로 중복 알림이 가지 않게 한다. 날짜가 바뀌면(다음 날 앱을 열면) 다시 대상에 포함된다.
- 전송 함수 `getNotifyTargets(vehicles, schedules, consumables, notifyLog, today)` 순수 함수로 구현: `getFleetSummary`가 집계한 overdue/due-soon 항목 전체 중 오늘자 로그에 없는 항목만 반환.

**체크 및 전송 흐름**
- 앱 로드 시(대시보드 렌더링 직후) 다음 순서로 실행:
  1. `loadNotifyConfig()`로 설정을 읽어 `enabled`가 `false`이거나 `webhookUrl`이 빈 값이면 **체크 로직 자체를 건너뛴다**.
  2. `enabled`이고 URL이 있으면 `getNotifyTargets(...)`로 오늘 처음 알리는 임박/경과 항목 목록을 구한다. 대상이 0건이면 전송하지 않는다.
  3. 대상이 1건 이상이면 **항목별로 여러 번 요청을 보내지 않고, 한 번의 웹훅 호출**에 전체 목록을 요약해 담아 전송한다(`sendWebhookNotification`, 4.5절 참고).
  4. 전송을 시도한 항목들은 성공 여부와 무관하게(네트워크 실패까지 재시도하지는 않음) `vehicle-fleet-notify-log`에 오늘 날짜로 기록해, 같은 날 재전송을 막는다.

**웹훅 payload 설계**
- 슬랙(`{ "text": "..." }`)·디스코드(`{ "content": "..." }`) 등 서비스마다 기대하는 키가 달라 하나로 완벽히 맞출 수는 없으므로, **범용 payload**를 구성해 최소한 사람이 읽을 요약 텍스트와 items 배열은 어떤 수신 서버에서도 파싱 가능하게 한다.
```js
{
  text: "[법인차량 관리] 임박 2건 · 경과 1건\n- 12가 1001 포터: 엔진오일 경과(3일 지남)\n- ...",
  overdueCount: number,
  dueSoonCount: number,
  items: [
    { vehiclePlate, vehicleType, category, label, status, dueDate },
    ...
  ],
}
```
- `text` 필드는 슬랙/디스코드처럼 텍스트 필드를 보는 서비스에서 그대로 표시되도록 사람이 읽기 쉬운 여러 줄 문자열로 만든다. 커스텀 서버(문자 API 등)를 쓰는 경우 관리자가 수신 측에서 `items` 배열을 직접 파싱해 원하는 형식으로 문자를 재구성해야 함을 5.7절 안내에 명시한다.

**전송 방식과 실패 처리**
- `fetch(webhookUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })` 형태로 전송한다. 브라우저에서 외부 웹훅 도메인으로 직접 요청하면 대상 서버의 CORS 설정에 따라 응답을 읽지 못할 수 있으므로, **`no-cors` 모드로 요청만 보내고 응답 본문/상태는 신경 쓰지 않는 방식**으로 설계한다(단, `no-cors`에서는 응답 성공 여부 자체를 알 수 없다는 한계를 감안해, `fetch` 자체가 던지는 네트워크 예외만 실패로 간주한다).
- `.catch(err => { console.warn(...); 마지막 전송 실패 상태를 화면에 작게 표시(선택 요소) })`로 처리해, 웹훅 전송 실패가 대시보드 로딩 등 앱의 다른 기능에 영향을 주지 않게 한다.
- "테스트 전송" 버튼(4.5절)은 위와 동일한 `sendWebhookNotification` 함수를 더미 payload(`{ text: "[법인차량 관리] 테스트 메시지입니다.", overdueCount: 0, dueSoonCount: 0, items: [] }`)로 호출해 같은 경로를 검증하되, 발송 로그(`vehicle-fleet-notify-log`)에는 기록하지 않는다.

## 4. 입력 처리

### 4.1 차량 등록/수정/삭제

- 차량 등록 폼: 차량번호(필수, text), 차종(필수, select — `VEHICLE_TYPES` 순회), 모델명(선택), 담당자/운전자(선택), 현재 주행거리(선택, number, km — 포크레인은 "가동시간" 안내 문구로 대체 표시), 비고(선택, textarea).
- 등록 시 차종을 고르면 해당 차종의 `defaultConsumables` 목록을 기반으로 "이 차량에 기본 소모품 항목을 자동으로 추가할까요?" 체크박스(기본 체크)를 제공, 체크 시 소모품 항목들을 `lastChangeDate` 미입력(추후 채우도록 목록에 "미입력" 상태로 표시) 상태로 함께 생성한다.
- 수정: 상세 화면에서 "차량 정보 수정" 버튼 → 동일 폼에 기존 값 채워 재사용(등록/수정 폼 공용 컴포넌트).
- 삭제: 상세 화면에서 "차량 삭제" 버튼 → `confirm()` 확인창(연결된 검사/소모품 항목도 함께 삭제됨을 명시) → cascade 삭제 → 대시보드로 이동.

### 4.2 검사·보험 항목 등록/수정/삭제

- 차량 상세 화면의 "검사/보험" 섹션에서 "항목 추가" 버튼 → 폼: 구분(정기검사/보험 select), 항목명(정기검사는 차종의 `inspectionLabel` 자동 채움, 보험은 자유입력 또는 프리셋 select), 마지막 일자(date, 필수), 주기(개월, number, 필수 — 단 다음 예정일을 직접 알고 있으면 "다음 예정일 직접 입력" 토글로 전환해 `nextDateOverride`만 입력하고 주기는 생략 가능), 비고.
- 이미 같은 `label`의 항목이 있으면 등록 대신 수정 폼으로 유도(3.3절).
- 수정/삭제는 항목 목록의 각 행에 연필/휴지통 아이콘 버튼으로 제공, 삭제는 `confirm()` 확인.

### 4.3 소모품 항목 등록/수정/삭제

- 차량 상세 화면의 "소모품" 섹션에서 "항목 추가" 버튼 → 폼: 종류(select, `CONSUMABLE_TYPES` — '기타' 선택 시 항목명 텍스트 입력란 노출), 마지막 교환일(date, 필수), 마지막 교환 시 주행거리(number, 선택), 교환주기 — 개월(number)과 km(number) 두 칸을 모두 열어두고 "둘 중 하나 이상 입력" 안내(HTML `required` 대신 JS 커스텀 검증), 비고.
- "교환 완료 처리" 버튼(목록 각 행에 배치): 클릭 시 오늘 날짜 + (선택) 현재 주행거리 입력 미니 폼을 인라인으로 펼쳐 `lastChangeDate`/`lastChangeOdometer`를 갱신(3.3절의 "최신 1건 유지" 방식 구현부).

### 4.4 마우스/키보드/터치 처리 및 모바일 폼 사용성

- 모든 인터랙션 요소는 시맨틱 `<button>`/`<select>`/`<a>`로 구현해 클릭·키보드(Tab+Enter/Space)·터치를 기본 지원.
- 차량 카드(대시보드)는 `<button>` 또는 `role="button"` + `tabindex="0"`으로 만들어 클릭/터치/Enter로 상세화면 진입.
- 폼 입력 필드는 `inputmode="numeric"`(주행거리·주기), `type="date"`(일자)로 모바일 입력 최적화.
- 폼 필드는 세로 1열 배치(라벨 위, 입력 아래), `font-size` 최소 16px(iOS 자동확대 방지), 버튼/입력 높이 44px 이상.
- select는 네이티브 UI 그대로 사용(커스텀 드롭다운 미구현).
- 상세화면 진입/이탈은 모달 대신 **화면 전환(같은 페이지 내 섹션 토글)** 방식으로 구현해, 뒤로가기 버튼(상단 "← 대시보드로" 링크)만으로 이동하도록 해 모바일에서 모달 중첩으로 인한 혼란을 줄인다.

### 4.5 알림 설정 입력 처리

- 대시보드에 "🔔 알림 설정" 버튼을 배치(위치는 5.1절 참고)하고, 클릭 시 알림 설정 모달(또는 인라인 섹션)을 연다.
- 모달 구성 요소:
  - 웹훅 URL 입력 필드(`type="url"`, placeholder에 "슬랙/디스코드 웹훅 URL 또는 발급받은 알림 엔드포인트" 등 예시 안내).
  - 알림 켜기/끄기 토글(체크박스 또는 스위치 UI) — 기본값은 `false`(꺼짐), URL을 입력해도 토글을 켜지 않으면 발송하지 않는다.
  - "테스트 전송" 버튼: 입력창에 있는 URL(아직 저장 전이어도 현재 입력값)로 3.8절의 더미 payload를 즉시 전송해보고, 전송 시도 결과(성공/실패는 알 수 없으므로 "전송을 시도했습니다" 안내 + 콘솔에서 네트워크 탭으로 확인하라는 문구)를 표시한다.
  - "저장" 버튼: `webhookUrl`/`enabled` 값을 `saveNotifyConfig`로 localStorage에 저장하고 모달을 닫는다. URL 형식이 명백히 비어있는데 `enabled`를 켠 경우 "URL을 입력해야 알림이 켜집니다" 인라인 경고를 표시하고 저장은 막지 않되 `enabled`를 자동으로 `false`로 보정해 저장한다.
  - 닫기 버튼/배경클릭/Esc로 모달 닫힘(설계 방식은 5.1~5.2절의 다른 모달·화면 전환 패턴과 통일).
- 모달을 열 때 `loadNotifyConfig()` 값을 입력 필드에 미리 채워, 기존에 저장한 설정을 수정하는 흐름도 동일 UI로 처리한다.
- URL 입력 필드는 비밀번호 필드가 아니므로 값 자체를 화면에 그대로 노출해도 되지만(사용자가 직접 발급받아 붙여넣는 값), 다른 사람이 화면을 볼 수 있는 공용 PC 환경을 고려해 "이 URL은 이 브라우저에만 저장되며 외부로 전송되지 않는다(알림 전송 시 웹훅 서버로만 전달됨)"는 안내를 모달 하단에 작게 덧붙인다.

## 5. UI/디자인

### 5.1 대시보드 레이아웃

- 상단 헤더: 앱 제목("**법인차량 관리**") + 다크모드 토글 버튼(사이트 본체와 동일 패턴).
- 헤더 바로 아래: 사용법 안내 박스(상시 노출, 접기 가능) — 5.5절 참고.
- 요약 카드 영역(대시보드 최상단): "전체 9대 · 검사/보험 임박 N건 · 경과 N건 · 소모품 임박 N건 · 경과 N건"을 큰 숫자 배지로 표시해 한눈에 파악되게 한다(`getFleetSummary` 결과 렌더링).
- 차량 카드 리스트(세로 스택 또는 2열 그리드 — 반응형): 각 카드에 차종 아이콘 + 차량번호 + 차종명 + 담당자 + 이 차량의 가장 급한 상태 배지(경과가 하나라도 있으면 "경과", 없고 임박이 있으면 "임박", 없으면 "정상")를 표시. 카드 클릭 시 상세화면 진입.
- "차량 등록" 버튼을 대시보드 상단에 고정 배치.
- 대시보드 하단 또는 헤더 우측에 내보내기/가져오기 버튼 배치(3.7절), **같은 줄에 "🔔 알림 설정" 버튼도 함께 배치**한다(예: 헤더 우측에 다크모드 토글·알림 설정 버튼, 요약 카드 영역 바로 아래 줄에 내보내기·가져오기·알림 설정 3개 버튼을 나란히). 알림이 꺼져 있거나 URL 미입력 상태면 버튼에 작은 "꺼짐" 표시(회색 점 등)를 붙여 현재 상태를 한눈에 알 수 있게 한다.

### 5.2 차량 상세 화면 레이아웃

- 상단에 "← 대시보드로" 뒤로가기 + 차량번호/차종/담당자 요약 헤더 + "수정"/"삭제" 버튼.
- **검사/보험 섹션**: 카드 또는 표 형태로 항목별(정기검사 1건 + 보험 1건 이상) 행 표시 — 항목명, 마지막 일자, 다음 예정일(계산값 또는 직접입력값), 상태 배지(정상/임박/경과), 수정/삭제 아이콘. "항목 추가" 버튼.
- **소모품 섹션**: 항목별(엔진오일 등) 행 표시 — 항목명, 마지막 교환일/주행거리, 교환주기(개월/km), 다음 교환 예정(날짜 및/또는 잔여 km), 상태 배지, "교환 완료 처리"/수정/삭제 버튼. "항목 추가" 버튼.
- 비고 등 기타 정보는 헤더 하단에 작게 표시.

### 5.3 임박/경과 상태 색상 구분

- 상태 배지 3종을 색상 + 텍스트 라벨을 함께 사용(색맹 등 접근성 고려, 색에만 의존하지 않음):
  - `overdue`(경과): 배경 빨강 계열(예: `#dc2626` 라이트 / `#f87171` 다크 — 사이트 팔레트에 경고색이 없으므로 앱 자체 CSS 변수 `--status-overdue`로 별도 정의하고 값만 하드코딩), 텍스트 "경과".
  - `due-soon`(임박): 배경 주황/노랑 계열(`--status-due-soon`), 텍스트 "임박".
  - `ok`(정상): 배경 `var(--color-bg-secondary)` + 텍스트 `var(--color-text-secondary)`, 텍스트 "정상".
  - `unknown`(계산불가, 항목 미입력): 배경 `var(--color-border)`, 텍스트 "미입력".
- 배지 색상 변수(`--status-overdue`, `--status-due-soon`, `--status-ok`)는 `style.css` 최상단에 사이트 팔레트 변수와 별도로 선언하되, 라이트/다크 모드 각각 값을 지정해 다크모드에서도 대비가 충분하도록 한다(예: 라이트 빨강 `#dc2626`/다크 `#f87171`, 라이트 주황 `#d97706`/다크 `#fbbf24`).

### 5.4 다크모드 대응

- 사이트 본체와 동일한 패턴을 그대로 따른다: `@media (prefers-color-scheme: dark)`로 `:root:not([data-theme='light'])`에 다크 팔레트 자동 적용 + `:root[data-theme='dark']`로 수동 오버라이드.
- 헤더 우측 원형 토글 버튼 클릭 시 `document.documentElement.setAttribute('data-theme', ...)` 값을 `light`/`dark` 사이에서 전환하고 `localStorage`(`vehicle-fleet-theme` 키)에 저장, 페이지 로드 시 저장된 값을 즉시 반영(FOUC 방지를 위해 `<head>` 인라인 스크립트로 최대한 빨리 적용하는 것도 고려).

### 5.5 팔레트 CSS 변수 참조 방식

- `apps/vehicle-fleet/style.css`가 사이트 전역 CSS를 로드하지 않는 독립 폴더 구조이므로, `:root`에서 사이트 본체와 동일한 변수명(`--color-bg`, `--color-bg-secondary`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-border`, `--color-code-bg`, `--font-body`, `--font-mono`)을 라이트/다크 값 그대로 재선언한다.
- 버튼/링크/강조 요소는 `--color-accent`, 카드/구분선은 `--color-bg-secondary`/`--color-border`를 사용해 팔레트 일관성을 유지하고, 상태 배지 3색만 5.3절의 앱 전용 변수를 추가로 사용한다.

### 5.6 반응형 고려사항

- 브레이크포인트: `max-width: 640px` 기준(사이트 `--max-width: 700px`와 정합).
- 차량 카드 그리드는 데스크톱 2~3열, 640px 이하에서 1열 스택.
- 검사/보험·소모품 섹션의 표는 좁은 화면에서 표 대신 카드형(행마다 세로 나열)으로 전환하거나, 표를 가로 스크롤 컨테이너로 감싸 잘림 방지.
- 폼 입력 요소는 모바일에서 `width: 100%`.

### 5.7 사용법 안내 문구 배치

- 헤더 바로 아래 상시 노출 안내 박스(접기/펼치기 가능, 접힘 상태는 `localStorage`에 기억)에 다음 내용을 포함:
  - 데이터는 이 브라우저에만 저장되며(localStorage), 다른 기기와 자동 동기화되지 않는다는 점과 내보내기/가져오기(JSON)로 백업·공유할 수 있다는 안내.
  - 대시보드 요약 배지(경과/임박 건수)의 의미와, 임박 기준(검사·보험은 만기 30일 전, 소모품은 30일 또는 잔여 1000km 이내)을 간단히 설명.
  - 시드로 들어있는 차량번호 등은 예시 데이터이므로 실제 값으로 수정해서 사용하라는 안내.
  - 포크레인처럼 도로 주행이 없는 중장비는 "자동차 정기검사"가 아닌 "건설기계 정기검사" 항목으로 관리된다는 점.
  - **웹훅 URL을 등록하고 알림을 켜면, 앱을 열 때마다(정해진 시각 자동 발송이 아니라 담당자가 접속한 시점 기준으로) 그 시점의 임박/경과 항목을 자동으로 계산해 등록한 웹훅 주소로 전송한다는 점**, 그리고 같은 항목은 하루에 한 번만 전송된다는 점.
  - **카카오톡/문자로 알림을 받고 싶다면 슬랙·디스코드 웹훅 URL이 아니라, 본인이 직접 그런 메시지를 대신 보내주는 웹훅 서비스(예: 카카오톡 "나에게 보내기" API, 문자 발송 API 등)를 통해 발급받은 URL을 입력해야 한다**는 안내(이 앱이 카카오톡/문자를 직접 보내는 기능을 내장한 것이 아니라, 사용자가 이미 가진 웹훅 엔드포인트로 데이터를 전달만 한다는 점을 명확히 함).

## 6. 작업 순서 (Build 단계 체크리스트)

1. `apps/vehicle-fleet/index.html` 뼈대 작성: 헤더(제목+다크모드 토글), 사용법 안내 박스, 대시보드 화면 컨테이너(요약 카드 자리+차량 카드리스트 자리+차량등록 버튼+내보내기/가져오기 버튼), 차량 상세 화면 컨테이너(뒤로가기+헤더요약+검사/보험 섹션+소모품 섹션 자리), 차량 등록/수정 폼 마크업, 검사·보험 항목 폼 마크업, 소모품 항목 폼 마크업, css/js 링크.
2. `style.css`에 사이트 CSS 변수 재선언(라이트/다크) + 상태 배지 전용 변수(`--status-overdue`/`--status-due-soon`/`--status-ok`) 정의, 기본 레이아웃(헤더/안내박스/카드) 스타일 작성.
3. `fleet.js`에 `VEHICLE_TYPES`, `CONSUMABLE_TYPES` 상수와 `DUE_SOON_DAYS`/`DUE_SOON_KM` 상수 정의.
4. `fleet.js`에 3.2절 데이터 스키마에 맞춘 시드 데이터(`SEED_VEHICLES` 9대, `SEED_SCHEDULES`, `SEED_CONSUMABLES`) 작성 — 상태가 정상/임박/경과에 골고루 분포하도록 날짜 역산.
5. `fleet.js`에 `loadVehicles/saveVehicles`, `loadSchedules/saveSchedules`, `loadConsumables/saveConsumables`(최초 실행 시 시드 주입, cascade 삭제 헬퍼 `deleteVehicleCascade` 포함) 구현 및 콘솔에서 동작 확인.
6. `fleet.js`에 `getNextDueDate`, `getKmRemaining`, `getItemStatus`, `getFleetSummary` 순수 함수 구현(3.4절) 및 임시 콘솔 테스트(경과/임박/정상/미입력 케이스 각각 확인).
7. `app.js`에 대시보드 렌더링 함수 구현: 요약 카드 + 차량 카드 리스트(`loadVehicles()` + 각 차량의 최악 상태 배지 계산) 그리기.
8. 화면 전환 로직 구현: 대시보드 ↔ 차량 상세 (같은 페이지 내 컨테이너 `display` 토글, "← 대시보드로" 버튼).
9. 차량 상세 화면 렌더링 함수 구현: 헤더 요약 + 검사/보험 섹션 표/카드 + 소모품 섹션 표/카드(상태 배지 포함) 그리기.
10. 차량 등록/수정 폼 완성 및 검증 로직(필수값 확인) + 등록 시 기본 소모품 자동 추가 체크박스 로직 구현, 저장 후 대시보드 재렌더링.
11. 차량 삭제(cascade 확인창 포함) 구현.
12. 검사/보험 항목 등록/수정/삭제 폼 및 로직 구현(중복 `label` 감지 시 수정 유도 포함), 주기 입력과 "다음 예정일 직접 입력" 토글 동작 확인.
13. 소모품 항목 등록/수정/삭제 폼 및 로직 구현(개월/km 둘 중 하나 이상 검증), "교환 완료 처리" 인라인 갱신 기능 구현.
14. 내보내기 기능 구현: vehicles/schedules/consumables를 하나의 JSON으로 묶어 `Blob`+`<a download>` 다운로드.
15. 가져오기 기능 구현: JSON 파일 선택 → 스키마 검증 → 덮어쓰기/병합 확인창 → 저장 → 전체 화면 재렌더링, 형식 오류 시 에러 안내.
16. 다크모드 수동 토글 구현 및 `localStorage`(`vehicle-fleet-theme`) 연동, 로드 시 즉시 반영.
17. 사용법 안내 박스 접기/펼치기 토글 구현.
18. 반응형 스타일 점검: 320~420px 좁은 화면에서 대시보드/상세화면/폼/표 레이아웃 확인 및 조정, 터치 타깃 44px 이상 확보.
19. 라이트/다크 모드 각각에서 대시보드/상세화면/폼/상태배지 육안 점검(배지 대비 포함).
20. 엣지 케이스 점검: 차량 0대(전부 삭제) 상태 안내, 검사/소모품 항목 미입력 상태("미입력" 배지), localStorage 파싱 실패 폴백, 가져오기 파일 형식 오류 처리, 날짜만 있고 km 없는 소모품/그 반대 케이스, 포크레인처럼 `currentOdometer` 미입력 차량에서 km 판정 생략 확인, 새로고침 후 데이터·테마 유지 여부.
21. `fleet.js`에 알림 설정 저장/조회 함수(`loadNotifyConfig`/`saveNotifyConfig`, key `vehicle-fleet-notify-config`) 및 발송 로그 저장/조회 함수(`loadNotifyLog`/`saveNotifyLog`, key `vehicle-fleet-notify-log`) 구현.
22. `fleet.js`에 `getNotifyTargets(vehicles, schedules, consumables, notifyLog, today)` 순수 함수 구현(3.8절 — overdue/due-soon 항목 중 오늘 아직 로그에 없는 것만 반환) 및 콘솔 테스트(같은 날 재호출 시 대상이 줄어드는지 확인).
23. `fleet.js`에 웹훅 payload 조립 함수(`buildNotifyPayload(targets)` — `text`/`overdueCount`/`dueSoonCount`/`items` 구성, 3.8절)와 `sendWebhookNotification(url, payload)`(`fetch` + `mode: 'no-cors'` + `.catch` 실패 처리) 구현.
24. `index.html`에 "🔔 알림 설정" 버튼과 알림 설정 모달 마크업(웹훅 URL 입력, 켜기/끄기 토글, 테스트 전송 버튼, 저장 버튼, 안내 문구) 추가, `style.css`에 해당 모달/버튼 상태 표시(꺼짐 점 등) 스타일 추가.
25. `app.js`에 알림 설정 모달 열기/닫기, 값 채우기(`loadNotifyConfig` 반영), 저장 버튼 클릭 시 `saveNotifyConfig` 호출 및 URL 미입력 시 `enabled` 자동 보정 로직 구현(4.5절).
26. `app.js`에 "테스트 전송" 버튼 클릭 시 더미 payload로 `sendWebhookNotification` 호출(발송 로그에는 기록하지 않음) 및 "전송을 시도했습니다" 안내 표시 구현.
27. `app.js`에서 대시보드 렌더링 직후 알림 체크·전송 트리거 연결: `loadNotifyConfig` 확인 → `enabled`/URL 없으면 스킵 → `getNotifyTargets` 호출 → 대상 있으면 `buildNotifyPayload` + `sendWebhookNotification` 1회 호출 → 전송 시도한 항목들을 오늘 날짜로 `notifyLog`에 기록 후 저장.
28. 중복 발송 방지 동작 확인: 같은 날 대시보드를 여러 번 새로고침해도 웹훅이 항목당 한 번만 전송 대상에 포함되는지(네트워크 탭 또는 임시 콘솔 로그로) 확인, 날짜를 바꿔(테스트용 `today` 파라미터로) 다음 날 재포함되는지 확인.
29. 알림이 꺼져 있거나 URL이 비어 있을 때 대시보드 로드 시 아무 요청도 발생하지 않는지 확인(네트워크 탭 점검), 웹훅 전송 실패(예: 잘못된 URL) 시에도 대시보드 렌더링 등 나머지 기능이 정상 동작하는지 확인.
