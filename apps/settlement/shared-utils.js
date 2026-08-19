// ---------------------------------------------------------------------
// SettlementShared — index.html(정산서 작성)과 invoices.html(계산서함)이
// 공통으로 쓰는 순수 유틸 함수 모음 + "저장된 정산서 저장소" 헬퍼.
//
// 이 파일은 settlement.js/invoices.js보다 먼저 로드되어야 한다.
// 전역 오염을 피하기 위해 window.SettlementShared 네임스페이스 하나만
// 노출한다(개별 함수를 전역에 흩뿌리지 않음).
//
// calcVat 등 계산 규칙은 반드시 이 파일 한 곳에만 존재해야 한다 — 두 화면이
// 각자 계산 로직을 따로 들고 있으면 반올림 방식 등이 어긋났을 때 자동
// 생성된 정산서 금액이 화면마다 다르게 보이는 치명적 버그로 이어진다.
// ---------------------------------------------------------------------
(function () {
  'use strict';

  var THEME_KEY = 'settlement-app-theme';
  var SAVED_PROJECTS_KEY = 'settlement-app-saved-projects';

  // ---------------------------------------------------------------------
  // 숫자 유틸
  // ---------------------------------------------------------------------
  function round(n) { return Math.round(n); }

  function calcVat(supplyAmount) {
    return round((Number(supplyAmount) || 0) * 0.1);
  }

  function calcTotal(supplyAmount, vat) {
    return (Number(supplyAmount) || 0) + (Number(vat) || 0);
  }

  function parseNumber(v) {
    if (typeof v === 'number') return isNaN(v) ? 0 : Math.round(v);
    if (v === null || v === undefined) return 0;
    var s = String(v).replace(/,/g, '');
    var neg = /^\s*-/.test(s);
    s = s.replace(/[^0-9]/g, '');
    var n = parseInt(s, 10);
    if (isNaN(n)) n = 0;
    return neg ? -n : n;
  }

  function formatNumber(n) {
    n = Number(n) || 0;
    return n.toLocaleString('ko-KR');
  }

  // 사업자등록번호: 숫자만 입력해도 "000-00-00000" 형식으로 자동 변환
  function formatBizRegNo(raw) {
    var digits = String(raw || '').replace(/[^0-9]/g, '').slice(0, 10);
    var out = digits.slice(0, 3);
    if (digits.length > 3) out += '-' + digits.slice(3, 5);
    if (digits.length > 5) out += '-' + digits.slice(5, 10);
    return out;
  }

  function escapeAttr(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeFilenamePart(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
  }

  // ---------------------------------------------------------------------
  // 정산서(state) 초기값 — index.html(정산서 작성)과 invoices.js(계산서함의
  // "공사명으로 정산서 생성")가 정확히 같은 모양의 state를 만들어야 하므로
  // 이 팩토리 함수들도 여기 한 곳에만 둔다. 두 화면이 각자 다른 모양의
  // 빈 정산서를 만들면 계산서함에서 자동 생성한 정산서가 index.html에서
  // 열렸을 때 필드 누락/형식 불일치로 깨질 수 있다.
  // ---------------------------------------------------------------------
  function makeSubcontractRow(id) {
    return {
      id: id,
      workType: '',
      issueDate: '',
      vendor: '',
      bizRegNo: '',
      supplyAmount: 0,
      taxInvoiceIssued: false,
      bank: '',
      payDate: '',
      paidAmount: 0,
      accountInfo: '',
      contact: '',
      note: ''
    };
  }

  function makeLaborRow(id) {
    return {
      id: id,
      issueDate: '',
      workerName: '',
      item: '',
      supplyAmount: 0,
      withholdingTax: 0
    };
  }

  function makeEtcRow(id) {
    return {
      id: id,
      issueDate: '',
      vendor: '',
      item: '',
      supplyAmount: 0,
      vat: 0
    };
  }

  function createEmptyState() {
    return {
      projectInfo: { name: '', supplyAmount: 0 },
      subcontract: [makeSubcontractRow(1)],
      labor: [makeLaborRow(1)],
      etc: [makeEtcRow(1)],
      account: { bankName: '', accountNumber: '' },
      subcontractNextId: 2,
      laborNextId: 2,
      etcNextId: 2
    };
  }

  function normalizeState(parsed) {
    var empty = createEmptyState();
    if (!parsed || typeof parsed !== 'object') return empty;
    return {
      projectInfo: Object.assign({}, empty.projectInfo, parsed.projectInfo || {}),
      subcontract: Array.isArray(parsed.subcontract) ? parsed.subcontract : empty.subcontract,
      labor: Array.isArray(parsed.labor) ? parsed.labor : empty.labor,
      etc: Array.isArray(parsed.etc) ? parsed.etc : empty.etc,
      account: Object.assign({}, empty.account, parsed.account || {}),
      subcontractNextId: parsed.subcontractNextId || empty.subcontractNextId,
      laborNextId: parsed.laborNextId || empty.laborNextId,
      etcNextId: parsed.etcNextId || empty.etcNextId
    };
  }

  // ---------------------------------------------------------------------
  // 다크모드 (js/theme.js 패턴을 별도 localStorage 키로 자체 구현)
  // 테마 키는 두 화면이 완전히 동일하게 공유한다(settlement-app-theme).
  // ---------------------------------------------------------------------
  function getPreferredTheme() {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateThemeToggleIcon(theme) {
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeToggleIcon(theme);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  // 페이지 렌더 전에 즉시 적용해 깜빡임을 방지한다. shared-utils.js가
  // settlement.js/invoices.js보다 먼저 로드되므로 이 시점(파싱 직후)에
  // 바로 실행하는 것이 가장 이르다.
  applyTheme(getPreferredTheme());

  // ---------------------------------------------------------------------
  // "저장된 정산서 저장소" — { [공사명]: 정산서state } 딕셔너리.
  // index.html의 현재 활성 상태(settlement-app-state, 작업 사본 1건)와는
  // 별개로, 공사명별 여러 정산서를 동시에 보관한다. 계산서함(invoices.js)의
  // 정산서 자동 생성과 index.html의 "저장된 정산서 불러오기"가 이 저장소를
  // 공유한다.
  // ---------------------------------------------------------------------
  function loadSavedProjects() {
    try {
      var raw = localStorage.getItem(SAVED_PROJECTS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      /* 손상된 데이터는 무시하고 빈 저장소로 취급 */
    }
    return {};
  }

  function saveSavedProjects(dict) {
    try {
      localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(dict));
    } catch (e) {
      /* storage unavailable - 무시 */
    }
  }

  // 공사명 하나를 키로 정산서 state 전체를 저장소에 덮어쓴다(미러 저장).
  function saveProjectByName(name, projectState) {
    if (!name) return;
    var dict = loadSavedProjects();
    dict[name] = projectState;
    saveSavedProjects(dict);
  }

  function getSavedProjectNames() {
    return Object.keys(loadSavedProjects());
  }

  window.SettlementShared = {
    round: round,
    calcVat: calcVat,
    calcTotal: calcTotal,
    parseNumber: parseNumber,
    formatNumber: formatNumber,
    formatBizRegNo: formatBizRegNo,
    escapeAttr: escapeAttr,
    sanitizeFilenamePart: sanitizeFilenamePart,

    makeSubcontractRow: makeSubcontractRow,
    makeLaborRow: makeLaborRow,
    makeEtcRow: makeEtcRow,
    createEmptyState: createEmptyState,
    normalizeState: normalizeState,

    THEME_KEY: THEME_KEY,
    getPreferredTheme: getPreferredTheme,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    updateThemeToggleIcon: updateThemeToggleIcon,

    SAVED_PROJECTS_KEY: SAVED_PROJECTS_KEY,
    loadSavedProjects: loadSavedProjects,
    saveSavedProjects: saveSavedProjects,
    saveProjectByName: saveProjectByName,
    getSavedProjectNames: getSavedProjectNames
  };
})();
