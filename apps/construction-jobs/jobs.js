// jobs.js — 데이터 정의, localStorage 연동, 필터/정렬/시세 가이드 순수 함수
// (spec.md 3절 참고)
//
// 이 앱은 "구직자가 자기 정보를 등록하면 구인업체가 찾아서 컨택하는" 인력풀이다.
// 여기서 다루는 데이터는 "공고(job posting)"가 아니라 "구직 프로필(worker profile)"이다.

const JOB_TYPES = [
  { id: 'carpenter', label: '목수' },
  { id: 'rebar', label: '철근공' },
  { id: 'signal', label: '신호수' },
  { id: 'laborer', label: '잡부' },
  { id: 'formwork', label: '형틀목공' },
  { id: 'electrician', label: '전기공' },
  { id: 'plumber', label: '배관공' },
  { id: 'etc', label: '기타' },
];

const STORAGE_KEY = 'construction-jobs-workers-list';
const INIT_FLAG_KEY = 'construction-jobs-workers-initialized';

// 직종 id -> 라벨 조회 헬퍼
function getJobTypeLabel(jobTypeId) {
  const found = JOB_TYPES.find((jt) => jt.id === jobTypeId);
  return found ? found.label : '기타';
}

// 시드 데이터: 구직 프로필 6건, 직종/지역/나이/경력 다양, verified true/false 골고루,
// 같은 직종+지역 조합이 최소 2건 이상 되도록 구성(시세 가이드가 처음부터 의미 있게 표시되도록)
const SEED_WORKERS = [
  {
    id: 'seed-1',
    jobType: 'carpenter',
    name: '김목수(형틀 15년차)',
    age: 52,
    career: '10년 이상 숙련공',
    regionMain: '서울',
    region: '서울 강동구',
    availableFrom: '2026-09-01',
    workDuration: 'long',
    desiredWage: 220000,
    wageType: 'daily',
    contact: '010-1111-2222',
    selfIntro: '형틀목공 전문, 안전교육 이수, 개인 공구 지참 가능합니다.',
    createdAt: '2026-08-20T09:00:00.000Z',
    verified: true,
  },
  {
    id: 'seed-2',
    jobType: 'carpenter',
    name: '이OO',
    age: 34,
    career: '5~10년',
    regionMain: '서울',
    region: '서울 송파구',
    availableFrom: '2026-09-05',
    workDuration: 'short',
    desiredWage: 190000,
    wageType: 'daily',
    contact: '010-2222-3333',
    selfIntro: '아파트 신축현장 경력 다수, 성실하게 일합니다.',
    createdAt: '2026-08-18T09:00:00.000Z',
    verified: false,
  },
  {
    id: 'seed-3',
    jobType: 'rebar',
    name: '박반장',
    age: 45,
    career: '10년 이상 숙련공',
    regionMain: '경기',
    region: '경기 수원시',
    availableFrom: '2026-09-10',
    workDuration: 'long',
    desiredWage: 230000,
    wageType: 'daily',
    contact: '010-3333-4444',
    selfIntro: '철근 배근/가공 전문, 팀 단위(2~3인) 작업 가능합니다.',
    createdAt: '2026-08-22T09:00:00.000Z',
    verified: true,
  },
  {
    id: 'seed-4',
    jobType: 'rebar',
    name: '최OO',
    age: 27,
    career: '신입/1~3년',
    regionMain: '경기',
    region: '경기 화성시',
    availableFrom: '2026-09-08',
    workDuration: 'short',
    desiredWage: 170000,
    wageType: 'daily',
    contact: '010-4444-5555',
    selfIntro: '체력 좋습니다. 보조 업무부터 성실히 배우겠습니다.',
    createdAt: '2026-08-15T09:00:00.000Z',
    verified: false,
  },
  {
    id: 'seed-5',
    jobType: 'signal',
    name: '정신호',
    age: 58,
    career: '5~10년',
    regionMain: '인천',
    region: '인천 연수구',
    availableFrom: '2026-09-03',
    workDuration: 'long',
    desiredWage: 150000,
    wageType: 'daily',
    contact: '010-5555-6666',
    selfIntro: '항만/도로공사 신호수 경력 다수, 안전관리자 자격 보유.',
    createdAt: '2026-08-23T09:00:00.000Z',
    verified: true,
  },
  {
    id: 'seed-6',
    jobType: 'laborer',
    name: '한OO',
    age: 39,
    career: '3~5년',
    regionMain: '서울',
    region: '서울 강서구',
    availableFrom: '2026-09-01',
    workDuration: 'long',
    desiredWage: 3200000,
    wageType: 'monthly',
    contact: '010-6666-7777',
    selfIntro: '월급제 상용직 희망, 4대보험 필요, 장기 근무 가능합니다.',
    createdAt: '2026-08-19T09:00:00.000Z',
    verified: false,
  },
];

// verified 필드 누락(구버전/가져오기 데이터)을 false로 보정
function normalizeWorker(worker) {
  return {
    ...worker,
    verified: typeof worker.verified === 'boolean' ? worker.verified : false,
  };
}

function saveWorkers(workersArray) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workersArray));
}

function loadWorkers() {
  const initialized = localStorage.getItem(INIT_FLAG_KEY);
  const raw = localStorage.getItem(STORAGE_KEY);

  if (raw === null) {
    if (!initialized) {
      // 최초 실행: 시드 데이터로 초기화
      saveWorkers(SEED_WORKERS);
      localStorage.setItem(INIT_FLAG_KEY, 'true');
      return SEED_WORKERS.map(normalizeWorker);
    }
    // 이미 초기화된 적이 있는데 데이터가 없다면(사용자가 전부 삭제) 빈 배열 유지
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('저장된 데이터가 배열이 아닙니다.');
    return parsed.map(normalizeWorker);
  } catch (err) {
    console.warn('[construction-jobs] localStorage 파싱 실패, 시드 데이터로 폴백합니다.', err);
    saveWorkers(SEED_WORKERS);
    localStorage.setItem(INIT_FLAG_KEY, 'true');
    return SEED_WORKERS.map(normalizeWorker);
  }
}

// 나이 -> 나이대 구간 순수 함수
function getAgeGroup(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 'unknown';
  if (a < 30) return 'age20';
  if (a < 40) return 'age30';
  if (a < 50) return 'age40';
  return 'age50plus';
}

// 필터 + 정렬 순수 함수 (원본 배열 불변)
function getFilteredWorkers(workers, options) {
  const {
    jobType = 'all',
    regionMain = 'all',
    ageGroup = 'all',
    sortKey = 'latest',
  } = options || {};

  let result = workers.slice();

  if (jobType && jobType !== 'all') {
    result = result.filter((w) => w.jobType === jobType);
  }
  if (regionMain && regionMain !== 'all') {
    result = result.filter((w) => w.regionMain === regionMain);
  }
  if (ageGroup && ageGroup !== 'all') {
    result = result.filter((w) => getAgeGroup(w.age) === ageGroup);
  }

  switch (sortKey) {
    case 'wage-desc':
      result.sort((a, b) => Number(b.desiredWage) - Number(a.desiredWage));
      break;
    case 'wage-asc':
      result.sort((a, b) => Number(a.desiredWage) - Number(b.desiredWage));
      break;
    case 'available-soon':
      result.sort((a, b) => new Date(a.availableFrom) - new Date(b.availableFrom));
      break;
    case 'latest':
    default:
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
  }

  return result;
}

// 시세 가이드: 같은 직종+지역의 다른 구직자들이 등록한 희망일당(daily) 평균 계산
// (구인업체가 아니라 구직자가 자기 몸값을 시세에 맞게 책정하도록 돕는 용도)
function getAverageWage(workers, jobType, regionMain) {
  if (!jobType || !regionMain) return null;

  const target = workers.filter(
    (w) => w.jobType === jobType && w.regionMain === regionMain && w.wageType === 'daily'
  );

  if (target.length === 0) return null;

  const sum = target.reduce((acc, w) => acc + Number(w.desiredWage || 0), 0);
  return Math.round(sum / target.length);
}
