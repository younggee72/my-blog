// fleet.js — 법인차량 관리: 차종/소모품 상수, 데이터 스키마, localStorage 저장/조회,
// 다음 예정일·임박/경과 계산 순수 함수, 시드 데이터(spec.md 3절 참고)

// ---------- 상수 ----------

const DUE_SOON_DAYS = 30;
const DUE_SOON_KM = 1000;

const VEHICLE_TYPES = [
  { id: 'porter', label: '포터(트럭)', icon: '🚚', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 12,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
  { id: 'dump', label: '2.5톤 덤프트럭', icon: '🚛', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 6,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
  { id: 'excavator', label: '포크레인(굴착기)', icon: '🚜', isRoadVehicle: false,
    inspectionLabel: '건설기계 정기검사', defaultInspectionCycleMonths: 12,
    defaultConsumables: ['engine_oil', 'hydraulic_oil', 'oil_filter'] },
  { id: 'car', label: '승용차', icon: '🚗', isRoadVehicle: true,
    inspectionLabel: '자동차 정기검사', defaultInspectionCycleMonths: 24,
    defaultConsumables: ['engine_oil', 'mission_oil', 'air_filter', 'oil_filter', 'tire'] },
];

const CONSUMABLE_TYPES = [
  { id: 'engine_oil', label: '엔진오일', unit: 'km', defaultCycleMonths: 6, defaultCycleKm: 10000 },
  { id: 'mission_oil', label: '미션오일(변속기오일)', unit: 'km', defaultCycleMonths: 24, defaultCycleKm: 40000 },
  { id: 'hydraulic_oil', label: '유압오일', unit: 'km', defaultCycleMonths: 12, defaultCycleKm: null },
  { id: 'air_filter', label: '에어필터', unit: 'km', defaultCycleMonths: 12, defaultCycleKm: 20000 },
  { id: 'oil_filter', label: '오일필터', unit: 'km', defaultCycleMonths: 6, defaultCycleKm: 10000 },
  { id: 'tire', label: '타이어', unit: 'km', defaultCycleMonths: 36, defaultCycleKm: 50000 },
  { id: 'etc', label: '기타 소모품', unit: 'km', defaultCycleMonths: null, defaultCycleKm: null },
];

const INSURANCE_LABEL_PRESETS = ['자동차보험', '건설기계보험', '화물자동차보험'];

// ---------- 조회 헬퍼 ----------

function getVehicleType(id) {
  return VEHICLE_TYPES.find((t) => t.id === id) || null;
}

function getConsumableType(id) {
  return CONSUMABLE_TYPES.find((t) => t.id === id) || null;
}

function generateId(prefix) {
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return prefix ? `${prefix}-${rand}` : rand;
}

function addMonthsToDate(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}

// ---------- localStorage 키 ----------

const VEHICLES_KEY = 'vehicle-fleet-vehicles';
const SCHEDULES_KEY = 'vehicle-fleet-schedules';
const CONSUMABLES_KEY = 'vehicle-fleet-consumables';
const INIT_FLAG_KEY = 'vehicle-fleet-initialized';
const NOTIFY_CONFIG_KEY = 'vehicle-fleet-notify-config';
const NOTIFY_LOG_KEY = 'vehicle-fleet-notify-log';

function safeParseArray(raw, contextLabel) {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('저장된 데이터가 배열이 아닙니다.');
    return parsed;
  } catch (err) {
    console.warn(`[vehicle-fleet] ${contextLabel} 파싱 실패, 빈 배열로 대체합니다.`, err);
    return [];
  }
}

function ensureSeeded() {
  if (localStorage.getItem(INIT_FLAG_KEY)) return;
  localStorage.setItem(VEHICLES_KEY, JSON.stringify(SEED_VEHICLES));
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(SEED_SCHEDULES));
  localStorage.setItem(CONSUMABLES_KEY, JSON.stringify(SEED_CONSUMABLES));
  localStorage.setItem(INIT_FLAG_KEY, 'true');
}

// ---------- 차량 저장/조회 ----------

function loadVehicles() {
  ensureSeeded();
  return safeParseArray(localStorage.getItem(VEHICLES_KEY), '차량 목록');
}

function saveVehicles(vehicles) {
  localStorage.setItem(VEHICLES_KEY, JSON.stringify(vehicles));
}

// ---------- 검사/보험 일정 저장/조회 ----------

function loadSchedules() {
  ensureSeeded();
  return safeParseArray(localStorage.getItem(SCHEDULES_KEY), '검사/보험 일정');
}

function saveSchedules(schedules) {
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(schedules));
}

// ---------- 소모품 저장/조회 ----------

function loadConsumables() {
  ensureSeeded();
  return safeParseArray(localStorage.getItem(CONSUMABLES_KEY), '소모품 항목');
}

function saveConsumables(consumables) {
  localStorage.setItem(CONSUMABLES_KEY, JSON.stringify(consumables));
}

// ---------- cascade 삭제 ----------

function deleteVehicleCascade(vehicleId) {
  const vehicles = loadVehicles().filter((v) => v.id !== vehicleId);
  const schedules = loadSchedules().filter((s) => s.vehicleId !== vehicleId);
  const consumables = loadConsumables().filter((c) => c.vehicleId !== vehicleId);
  saveVehicles(vehicles);
  saveSchedules(schedules);
  saveConsumables(consumables);
  return { vehicles, schedules, consumables };
}

// ---------- 다음 예정일 / 임박·경과 판정 계산 (순수 함수) ----------

function getNextDueDate(item) {
  if (item.nextDateOverride) return item.nextDateOverride;
  const baseDateStr = item.lastDate || item.lastChangeDate;
  if (!baseDateStr) return null;
  const months = item.cycleMonths;
  if (!months) return null;
  return addMonthsToDate(baseDateStr, months);
}

function getKmRemaining(item, currentOdometer) {
  if (!item.cycleKm || item.lastChangeOdometer == null || currentOdometer == null) return null;
  return (item.lastChangeOdometer + item.cycleKm) - currentOdometer;
}

function getItemStatus(item, currentOdometer, today) {
  today = today || new Date();
  const dueDate = getNextDueDate(item);
  const kmRemaining = getKmRemaining(item, currentOdometer);
  const results = [];

  if (dueDate) {
    const daysLeft = Math.floor((new Date(dueDate) - today) / 86400000);
    results.push(daysLeft < 0 ? 'overdue' : daysLeft <= DUE_SOON_DAYS ? 'due-soon' : 'ok');
  }
  if (kmRemaining != null) {
    results.push(kmRemaining < 0 ? 'overdue' : kmRemaining <= DUE_SOON_KM ? 'due-soon' : 'ok');
  }
  if (results.length === 0) return 'unknown';
  if (results.includes('overdue')) return 'overdue';
  if (results.includes('due-soon')) return 'due-soon';
  return 'ok';
}

// 차량 한 대의 카드에 표시할 "가장 급한 상태"(경과 > 임박 > 정상, unknown은 무시)
function getVehicleWorstStatus(vehicleId, schedules, consumables, currentOdometer, today) {
  const items = [
    ...schedules.filter((s) => s.vehicleId === vehicleId),
    ...consumables.filter((c) => c.vehicleId === vehicleId),
  ];
  let worst = 'ok';
  items.forEach((item) => {
    const status = getItemStatus(item, currentOdometer, today);
    if (status === 'overdue') worst = 'overdue';
    else if (status === 'due-soon' && worst !== 'overdue') worst = 'due-soon';
  });
  return worst;
}

// 전체 차량 대상 요약 집계 (대시보드 요약 카드용)
function getFleetSummary(vehicles, schedules, consumables, today) {
  today = today || new Date();
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const summary = {
    totalVehicles: vehicles.length,
    scheduleOverdue: 0,
    scheduleDueSoon: 0,
    consumableOverdue: 0,
    consumableDueSoon: 0,
  };

  schedules.forEach((s) => {
    const vehicle = vehicleById.get(s.vehicleId);
    if (!vehicle) return;
    const status = getItemStatus(s, vehicle.currentOdometer, today);
    if (status === 'overdue') summary.scheduleOverdue += 1;
    else if (status === 'due-soon') summary.scheduleDueSoon += 1;
  });

  consumables.forEach((c) => {
    const vehicle = vehicleById.get(c.vehicleId);
    if (!vehicle) return;
    const status = getItemStatus(c, vehicle.currentOdometer, today);
    if (status === 'overdue') summary.consumableOverdue += 1;
    else if (status === 'due-soon') summary.consumableDueSoon += 1;
  });

  return summary;
}

// ---------- 알림(웹훅) 설정 ----------

function loadNotifyConfig() {
  try {
    const raw = localStorage.getItem(NOTIFY_CONFIG_KEY);
    if (!raw) return { webhookUrl: '', enabled: false };
    const parsed = JSON.parse(raw);
    return {
      webhookUrl: typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl : '',
      enabled: !!parsed.enabled,
    };
  } catch (err) {
    console.warn('[vehicle-fleet] 알림 설정 파싱 실패, 기본값으로 대체합니다.', err);
    return { webhookUrl: '', enabled: false };
  }
}

function saveNotifyConfig(config) {
  localStorage.setItem(NOTIFY_CONFIG_KEY, JSON.stringify({
    webhookUrl: config.webhookUrl || '',
    enabled: !!config.enabled,
  }));
}

function loadNotifyLog() {
  try {
    const raw = localStorage.getItem(NOTIFY_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    console.warn('[vehicle-fleet] 알림 발송 로그 파싱 실패, 빈 값으로 대체합니다.', err);
    return {};
  }
}

function saveNotifyLog(log) {
  localStorage.setItem(NOTIFY_LOG_KEY, JSON.stringify(log));
}

// 오늘 처음 알리는 임박/경과 항목만 골라내는 순수 함수
function getNotifyTargets(vehicles, schedules, consumables, notifyLog, today) {
  today = today || new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const targets = [];

  schedules.forEach((s) => {
    const vehicle = vehicleById.get(s.vehicleId);
    if (!vehicle) return;
    const status = getItemStatus(s, vehicle.currentOdometer, today);
    if (status !== 'overdue' && status !== 'due-soon') return;
    const key = `schedule:${s.id}`;
    if (notifyLog[key] === todayStr) return;
    const typeInfo = getVehicleType(vehicle.vehicleType);
    targets.push({
      key,
      vehiclePlate: vehicle.plateNumber,
      vehicleType: typeInfo ? typeInfo.label : vehicle.vehicleType,
      category: s.category,
      label: s.label,
      status,
      dueDate: getNextDueDate(s),
    });
  });

  consumables.forEach((c) => {
    const vehicle = vehicleById.get(c.vehicleId);
    if (!vehicle) return;
    const status = getItemStatus(c, vehicle.currentOdometer, today);
    if (status !== 'overdue' && status !== 'due-soon') return;
    const key = `consumable:${c.id}`;
    if (notifyLog[key] === todayStr) return;
    const typeInfo = getVehicleType(vehicle.vehicleType);
    const consumableInfo = getConsumableType(c.itemType);
    const label = c.itemType === 'etc' ? (c.customLabel || '기타 소모품') : (consumableInfo ? consumableInfo.label : c.itemType);
    targets.push({
      key,
      vehiclePlate: vehicle.plateNumber,
      vehicleType: typeInfo ? typeInfo.label : vehicle.vehicleType,
      category: 'consumable',
      label,
      status,
      dueDate: getNextDueDate(c),
    });
  });

  return targets;
}

// 범용 웹훅 payload 조립
function buildNotifyPayload(targets) {
  const overdueCount = targets.filter((t) => t.status === 'overdue').length;
  const dueSoonCount = targets.filter((t) => t.status === 'due-soon').length;
  const lines = targets.map((t) => {
    const statusLabel = t.status === 'overdue' ? '경과' : '임박';
    const dueText = t.dueDate ? `(${t.dueDate})` : '';
    return `- ${t.vehiclePlate} ${t.vehicleType}: ${t.label} ${statusLabel} ${dueText}`.trim();
  });
  const text = `[법인차량 관리] 임박 ${dueSoonCount}건 · 경과 ${overdueCount}건\n${lines.join('\n')}`;

  return {
    text,
    overdueCount,
    dueSoonCount,
    items: targets.map((t) => ({
      vehiclePlate: t.vehiclePlate,
      vehicleType: t.vehicleType,
      category: t.category,
      label: t.label,
      status: t.status,
      dueDate: t.dueDate,
    })),
  };
}

// no-cors 모드로 발송만 하고 결과는 신경 쓰지 않음(요청 자체 실패만 감지)
function sendWebhookNotification(url, payload) {
  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(() => true).catch((err) => {
    console.warn('[vehicle-fleet] 웹훅 전송 실패', err);
    return false;
  });
}

// ---------- 시드 데이터 ----------
// 실제 보유 대수(포터 6, 덤프 1, 포크레인 1, 승용차 1 = 9대)에 맞춘 예시 데이터.
// 차량번호 등은 가상의 예시 값이며, 기준일(2026-08-29) 대비 정상/임박/경과 상태가
// 골고루 섞이도록 날짜를 역산해서 구성했다.

const SEED_VEHICLES = [
  { id: 'v-porter-1', plateNumber: '12가 1001', vehicleType: 'porter', modelName: '포터2 초장축', driver: '김민수', note: '', currentOdometer: 82000, firstRegisteredDate: '2023-12-20', createdAt: '2024-01-10T09:00:00.000Z' },
  { id: 'v-porter-2', plateNumber: '12가 1002', vehicleType: 'porter', modelName: '포터2 초장축', driver: '이철수', note: '', currentOdometer: 65000, firstRegisteredDate: '2024-02-01', createdAt: '2024-02-15T09:00:00.000Z' },
  { id: 'v-porter-3', plateNumber: '12가 1003', vehicleType: 'porter', modelName: '포터2 슈퍼캡', driver: '박영희', note: '자재 운반 전담', currentOdometer: 120000, firstRegisteredDate: '2023-10-15', createdAt: '2023-11-01T09:00:00.000Z' },
  { id: 'v-porter-4', plateNumber: '12가 1004', vehicleType: 'porter', modelName: '포터2 초장축', driver: '최성훈', note: '', currentOdometer: 45000, firstRegisteredDate: '2024-06-05', createdAt: '2024-06-20T09:00:00.000Z' },
  { id: 'v-porter-5', plateNumber: '12가 1005', vehicleType: 'porter', modelName: '포터2 슈퍼캡', driver: '정다은', note: '', currentOdometer: 98000, firstRegisteredDate: '2023-08-20', createdAt: '2023-09-05T09:00:00.000Z' },
  { id: 'v-porter-6', plateNumber: '12가 1006', vehicleType: 'porter', modelName: '포터2 초장축', driver: '강태현', note: '신차 교체분', currentOdometer: 30000, firstRegisteredDate: '2025-01-05', createdAt: '2025-01-15T09:00:00.000Z' },
  { id: 'v-dump-1', plateNumber: '34나 2001', vehicleType: 'dump', modelName: '2.5톤 덤프', driver: '오준영', note: '사업용(화물)', currentOdometer: 150000, firstRegisteredDate: '2022-04-10', createdAt: '2022-05-01T09:00:00.000Z' },
  { id: 'v-excavator-1', plateNumber: '포크레인 1호기', vehicleType: 'excavator', modelName: '0.6㎥급 굴착기', driver: '한도현', note: '가동시간 기준 관리(주행거리 미입력)', currentOdometer: null, firstRegisteredDate: '2022-07-25', createdAt: '2022-08-10T09:00:00.000Z' },
  { id: 'v-car-1', plateNumber: '12가 9001', vehicleType: 'car', modelName: '쏘나타', driver: '대표이사', note: '업무용 승용차', currentOdometer: 20000, firstRegisteredDate: '2024-02-15', createdAt: '2024-03-01T09:00:00.000Z' },
];

const SEED_SCHEDULES = [
  // 포터1 — 검사 경과, 보험 임박
  { id: 's-1', vehicleId: 'v-porter-1', category: 'inspection', label: '자동차 정기검사', lastDate: '2025-08-20', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-2', vehicleId: 'v-porter-1', category: 'insurance', label: '자동차보험', lastDate: '2025-09-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포터2 — 정상
  { id: 's-3', vehicleId: 'v-porter-2', category: 'inspection', label: '자동차 정기검사', lastDate: '2026-02-15', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-4', vehicleId: 'v-porter-2', category: 'insurance', label: '자동차보험', lastDate: '2026-01-10', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포터3 — 검사 임박, 보험 경과
  { id: 's-5', vehicleId: 'v-porter-3', category: 'inspection', label: '자동차 정기검사', lastDate: '2025-09-05', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-6', vehicleId: 'v-porter-3', category: 'insurance', label: '자동차보험', lastDate: '2025-08-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포터4 — 정상
  { id: 's-7', vehicleId: 'v-porter-4', category: 'inspection', label: '자동차 정기검사', lastDate: '2026-03-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-8', vehicleId: 'v-porter-4', category: 'insurance', label: '자동차보험', lastDate: '2026-04-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포터5 — 검사 경과
  { id: 's-9', vehicleId: 'v-porter-5', category: 'inspection', label: '자동차 정기검사', lastDate: '2025-08-25', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-10', vehicleId: 'v-porter-5', category: 'insurance', label: '자동차보험', lastDate: '2026-06-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포터6 — 정상
  { id: 's-11', vehicleId: 'v-porter-6', category: 'inspection', label: '자동차 정기검사', lastDate: '2026-05-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-12', vehicleId: 'v-porter-6', category: 'insurance', label: '자동차보험', lastDate: '2026-07-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 덤프1 — 검사 임박(화물차 6개월 주기)
  { id: 's-13', vehicleId: 'v-dump-1', category: 'inspection', label: '자동차 정기검사', lastDate: '2026-03-10', cycleMonths: 6, nextDateOverride: null, note: '사업용 화물차 — 실제 통지서 기준으로 주기를 다시 확인할 것' },
  { id: 's-14', vehicleId: 'v-dump-1', category: 'insurance', label: '화물자동차보험', lastDate: '2026-02-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 포크레인1 — 건설기계 검사 경과
  { id: 's-15', vehicleId: 'v-excavator-1', category: 'inspection', label: '건설기계 정기검사', lastDate: '2025-08-01', cycleMonths: 12, nextDateOverride: null, note: '' },
  { id: 's-16', vehicleId: 'v-excavator-1', category: 'insurance', label: '건설기계보험', lastDate: '2026-06-15', cycleMonths: 12, nextDateOverride: null, note: '' },
  // 승용차1 — 검사 경과(비사업용 24개월 주기)
  { id: 's-17', vehicleId: 'v-car-1', category: 'inspection', label: '자동차 정기검사', lastDate: '2024-08-01', cycleMonths: 24, nextDateOverride: null, note: '' },
  { id: 's-18', vehicleId: 'v-car-1', category: 'insurance', label: '자동차보험', lastDate: '2026-05-01', cycleMonths: 12, nextDateOverride: null, note: '' },
];

const SEED_CONSUMABLES = [
  // 포터1 — 정상
  { id: 'c-1', vehicleId: 'v-porter-1', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: 78000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-2', vehicleId: 'v-porter-1', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: 78000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 포터2 — 엔진오일 경과
  { id: 'c-3', vehicleId: 'v-porter-2', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2025-11-01', lastChangeOdometer: 60000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-4', vehicleId: 'v-porter-2', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-07-01', lastChangeOdometer: 64000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 포터3 — 엔진오일 경과
  { id: 'c-5', vehicleId: 'v-porter-3', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-02-01', lastChangeOdometer: 110000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-6', vehicleId: 'v-porter-3', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-07-15', lastChangeOdometer: 118000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 포터4 — 정상
  { id: 'c-7', vehicleId: 'v-porter-4', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-08-01', lastChangeOdometer: 44000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-8', vehicleId: 'v-porter-4', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-08-01', lastChangeOdometer: 44000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 포터5 — 엔진오일 경과
  { id: 'c-9', vehicleId: 'v-porter-5', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-02-15', lastChangeOdometer: 90000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-10', vehicleId: 'v-porter-5', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-07-01', lastChangeOdometer: 95000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 포터6 — 오일필터 임박
  { id: 'c-11', vehicleId: 'v-porter-6', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-07-15', lastChangeOdometer: 28000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-12', vehicleId: 'v-porter-6', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-03-10', lastChangeOdometer: 29000, cycleMonths: 6, cycleKm: 10000, note: '' },
  // 덤프1 — 미션오일/타이어 경과
  { id: 'c-13', vehicleId: 'v-dump-1', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-05-01', lastChangeOdometer: 145000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-14', vehicleId: 'v-dump-1', itemType: 'mission_oil', customLabel: '', lastChangeDate: '2024-06-01', lastChangeOdometer: 100000, cycleMonths: 24, cycleKm: 40000, note: '' },
  { id: 'c-15', vehicleId: 'v-dump-1', itemType: 'air_filter', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: 140000, cycleMonths: 12, cycleKm: 20000, note: '' },
  { id: 'c-16', vehicleId: 'v-dump-1', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-05-01', lastChangeOdometer: 145000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-17', vehicleId: 'v-dump-1', itemType: 'tire', customLabel: '', lastChangeDate: '2024-08-01', lastChangeOdometer: 90000, cycleMonths: 36, cycleKm: 50000, note: '' },
  // 포크레인1 — 주행거리 미입력, 엔진오일 경과(날짜 기준만 적용)
  { id: 'c-18', vehicleId: 'v-excavator-1', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-02-01', lastChangeOdometer: null, cycleMonths: 6, cycleKm: null, note: '가동시간 기준 관리, km 미입력' },
  { id: 'c-19', vehicleId: 'v-excavator-1', itemType: 'hydraulic_oil', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: null, cycleMonths: 12, cycleKm: null, note: '' },
  { id: 'c-20', vehicleId: 'v-excavator-1', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-07-01', lastChangeOdometer: null, cycleMonths: 6, cycleKm: null, note: '' },
  // 승용차1 — 타이어 경과
  { id: 'c-21', vehicleId: 'v-car-1', itemType: 'engine_oil', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: 17000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-22', vehicleId: 'v-car-1', itemType: 'mission_oil', customLabel: '', lastChangeDate: '2025-06-01', lastChangeOdometer: 10000, cycleMonths: 24, cycleKm: 40000, note: '' },
  { id: 'c-23', vehicleId: 'v-car-1', itemType: 'air_filter', customLabel: '', lastChangeDate: '2026-01-01', lastChangeOdometer: 12000, cycleMonths: 12, cycleKm: 20000, note: '' },
  { id: 'c-24', vehicleId: 'v-car-1', itemType: 'oil_filter', customLabel: '', lastChangeDate: '2026-06-01', lastChangeOdometer: 17000, cycleMonths: 6, cycleKm: 10000, note: '' },
  { id: 'c-25', vehicleId: 'v-car-1', itemType: 'tire', customLabel: '', lastChangeDate: '2023-08-01', lastChangeOdometer: 5000, cycleMonths: 36, cycleKm: 50000, note: '' },
];
