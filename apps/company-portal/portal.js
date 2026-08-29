// portal.js — 사내 포털: 현장 데이터 스키마, localStorage 저장/조회, 시드 데이터,
// vehicle-fleet 읽기 전용 연동 헬퍼, 단계 상수, 금액 포맷터 (spec.md 3절 참고)

// ---------- localStorage 키 ----------

const SITES_KEY = 'company-portal-sites';
const INIT_FLAG_KEY = 'company-portal-initialized';

// vehicle-fleet 쪽 키/필드명을 한 곳에 모아 향후 스키마 변경 시 수정 지점을 최소화한다.
// (읽기 전용 참조. company-portal은 이 키에 절대 쓰지 않는다.)
const VEHICLE_FLEET_VEHICLES_KEY = 'vehicle-fleet-vehicles';

// ---------- 접근 제어(비밀번호 잠금, spec.md 7.3절) ----------
// 평문 비밀번호는 코드 어디에도 저장하지 않는다. sha256("7200")의 16진수 해시값만 상수로 둔다.
const PASSWORD_HASH = '3c5d8ca315f8c36d4cd4beecbc55b34c92a2d6eb1df730908df6f23dd2aa08f7';
// 잠금 해제 상태는 세션 종료(탭 닫기) 시 사라지도록 sessionStorage에 저장한다(공용 PC 대응, spec.md 7.3절 참고).
const UNLOCK_SESSION_KEY = 'company-portal-unlocked';

// 사용자가 입력한 문자열을 SHA-256으로 해시해 16진수 문자열로 반환한다(Web Crypto API, 외부 라이브러리 불필요).
async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 입력값의 해시가 PASSWORD_HASH와 일치하는지 비동기로 확인한다.
async function verifyPassword(input) {
  const hash = await sha256Hex(input);
  return hash === PASSWORD_HASH;
}

function isUnlocked() {
  return sessionStorage.getItem(UNLOCK_SESSION_KEY) === 'true';
}

function setUnlocked() {
  sessionStorage.setItem(UNLOCK_SESSION_KEY, 'true');
}

function lockAgain() {
  sessionStorage.removeItem(UNLOCK_SESSION_KEY);
}

// ---------- 현장 진행 단계 상수 ----------

const SITE_STAGES = [
  { id: 'before-start', label: '착공전', icon: '🏳️', progressHint: 0 },
  { id: 'foundation', label: '기초', icon: '🧱', progressHint: 15 },
  { id: 'frame', label: '골조', icon: '🏗️', progressHint: 45 },
  { id: 'finishing', label: '마감', icon: '🎨', progressHint: 80 },
  { id: 'completed', label: '준공', icon: '✅', progressHint: 100 },
];

function getSiteStage(id) {
  return SITE_STAGES.find((s) => s.id === id) || null;
}

// ---------- 공통 헬퍼 ----------

function generateId(prefix) {
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return prefix ? `${prefix}-${rand}` : rand;
}

function formatAmount(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ko-KR') + '원';
}

function safeParseArray(raw, contextLabel) {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('저장된 데이터가 배열이 아닙니다.');
    return parsed;
  } catch (err) {
    console.warn(`[company-portal] ${contextLabel} 파싱 실패, 빈 배열로 대체합니다.`, err);
    return [];
  }
}

// ---------- vehicle-fleet 읽기 전용 연동 ----------
// vehicle-fleet 앱의 데이터 구조({ id, plateNumber, vehicleType, ... })가 바뀌어도
// 이 앱 전체가 죽지 않도록, 항상 try/catch + 방어적 필드 검사를 거쳐 실패 시 빈 배열로 폴백한다.
// 이 함수는 절대 vehicle-fleet-vehicles 키에 쓰기(setItem)를 하지 않는다.
function getVehicleFleetVehiclesReadOnly() {
  try {
    const raw = localStorage.getItem(VEHICLE_FLEET_VEHICLES_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => v && typeof v === 'object' && typeof v.plateNumber === 'string' && v.plateNumber.trim() !== '');
  } catch (err) {
    console.warn('[company-portal] vehicle-fleet-vehicles 읽기/파싱 실패, 빈 목록으로 대체합니다.', err);
    return [];
  }
}

// ---------- 현장 저장/조회 ----------

function loadSites() {
  ensureSeeded();
  return safeParseArray(localStorage.getItem(SITES_KEY), '현장 목록');
}

function saveSites(sites) {
  localStorage.setItem(SITES_KEY, JSON.stringify(sites));
}

function getSiteById(sites, id) {
  return sites.find((s) => s.id === id) || null;
}

function createEmptySite() {
  return {
    id: '',
    name: '',
    address: '',
    startDate: '',
    endDatePlanned: '',
    manager: '',
    progressPercent: 0,
    stage: 'before-start',
    contractAmount: 0,
    billedAmount: 0,
    collectedAmount: 0,
    vehiclePlates: [],
    vehicleFreeText: '',
    memo: '',
    createdAt: '',
    updatedAt: '',
  };
}

// ---------- 시드 데이터 ----------
// vehicle-fleet에 이미 등록된 포터 차량이 있으면(같은 오리진 localStorage를 통해서만,
// 읽기 전용으로) plateNumber를 최대 2개까지 매칭 시도한다. 없으면 빈 배열로 둔다.
function buildSeedSites() {
  const fleetVehicles = getVehicleFleetVehiclesReadOnly();
  const porterPlates = fleetVehicles
    .filter((v) => v.vehicleType === 'porter')
    .map((v) => v.plateNumber)
    .slice(0, 2);

  const now = new Date().toISOString();

  return [
    {
      id: generateId('site'),
      name: 'oo아파트 신축공사',
      address: '서울시 OO구 OO동 123',
      startDate: '2026-03-02',
      endDatePlanned: '2027-08-31',
      manager: '김현장',
      progressPercent: 45,
      stage: 'frame',
      contractAmount: 3200000000,
      billedAmount: 1400000000,
      collectedAmount: 1200000000,
      vehiclePlates: porterPlates,
      vehicleFreeText: porterPlates.length ? '' : '포터 2대, 포크레인 1대 투입',
      memo: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId('site'),
      name: 'oo물류센터 증축공사',
      address: '경기도 OO시 OO로 45',
      startDate: '2026-06-10',
      endDatePlanned: '2026-12-20',
      manager: '박소장',
      progressPercent: 15,
      stage: 'foundation',
      contractAmount: 980000000,
      billedAmount: 150000000,
      collectedAmount: 150000000,
      vehiclePlates: [],
      vehicleFreeText: '덤프 1대 상시 투입',
      memo: '',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function ensureSeeded() {
  if (localStorage.getItem(INIT_FLAG_KEY)) return;
  localStorage.setItem(SITES_KEY, JSON.stringify(buildSeedSites()));
  localStorage.setItem(INIT_FLAG_KEY, 'true');
}
