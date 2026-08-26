// app.js — DOM 렌더링, 이벤트 바인딩, 폼 검증, 모달, 내보내기/가져오기, 다크모드
//
// 인력 목록 탭 = 구인업체가 구직 프로필을 탐색하는 화면
// 구직 등록 탭 = 구직자 본인이 자기 정보를 올리는 화면

(function () {
  'use strict';

  const REGIONS = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주', '기타'];

  let workers = loadWorkers();
  let filterState = { jobType: 'all', regionMain: 'all', ageGroup: 'all', sortKey: 'latest' };

  // ---------- 요소 참조 ----------
  const workerListEl = document.getElementById('worker-list');
  const emptyMsgEl = document.getElementById('empty-msg');
  const filterJobTypeEl = document.getElementById('filter-jobtype');
  const filterRegionEl = document.getElementById('filter-region');
  const filterAgeGroupEl = document.getElementById('filter-agegroup');
  const filterSortEl = document.getElementById('filter-sort');

  const tabListBtn = document.getElementById('tab-list-btn');
  const tabFormBtn = document.getElementById('tab-form-btn');
  const tabListPanel = document.getElementById('tab-list');
  const tabFormPanel = document.getElementById('tab-form');

  const formEl = document.getElementById('worker-form');
  const fJobType = document.getElementById('f-jobtype');
  const fRegionMain = document.getElementById('f-regionmain');
  const fWageType = document.getElementById('f-wagetype');
  const fDesiredWage = document.getElementById('f-desiredwage');
  const wageGuideEl = document.getElementById('wage-guide');
  const formToastEl = document.getElementById('form-toast');

  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalBadges = document.getElementById('modal-badges');
  const modalClose = document.getElementById('modal-close');
  const contactBtn = document.getElementById('contact-btn');
  const contactArea = document.getElementById('contact-area');

  const themeToggle = document.getElementById('theme-toggle');
  const guideBox = document.getElementById('guide-box');
  const guideToggle = document.getElementById('guide-toggle');
  const guideContent = document.getElementById('guide-content');
  const guideToggleLabel = document.getElementById('guide-toggle-label');

  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  let lastFocusedEl = null;

  // ---------- select 옵션 채우기 ----------
  function populateJobTypeSelects() {
    const optionsHtml = JOB_TYPES.map((jt) => `<option value="${jt.id}">${jt.label}</option>`).join('');

    filterJobTypeEl.innerHTML = `<option value="all">전체 직종</option>${optionsHtml}`;
    fJobType.innerHTML = `<option value="">직종 선택</option>${optionsHtml}`;
  }

  function populateRegionSelects() {
    const optionsHtml = REGIONS.map((r) => `<option value="${r}">${r}</option>`).join('');

    filterRegionEl.innerHTML = `<option value="all">전체 지역</option>${optionsHtml}`;
    fRegionMain.innerHTML = `<option value="">지역 선택</option>${optionsHtml}`;
  }

  // ---------- 목록 렌더링 ----------
  function formatWage(worker) {
    const amount = Number(worker.desiredWage).toLocaleString('ko-KR');
    return worker.wageType === 'monthly' ? `희망 월급 ${amount}원` : `희망일당 ${amount}원`;
  }

  const WORK_DURATION_LABEL = { short: '단기', long: '장기' };

  function renderWorkerCard(worker) {
    const verifiedBadge = worker.verified ? '<span class="badge badge-verified">✓ 인증 인력</span>' : '';
    const region = worker.region ? worker.region : worker.regionMain;
    const careerText = worker.career ? worker.career : '경력 정보 없음';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'job-card';
    card.setAttribute('data-worker-id', worker.id);
    card.innerHTML = `
      <div class="job-card-top">
        <span class="badge">${getJobTypeLabel(worker.jobType)}</span>
        ${verifiedBadge}
      </div>
      <p class="job-card-title">${escapeHtml(worker.name)} · ${worker.age}세</p>
      <div class="job-card-meta">
        <span>📍 ${escapeHtml(region)}</span>
        <span>🛠 ${escapeHtml(careerText)}</span>
        <span>💰 ${formatWage(worker)}</span>
        <span>📅 ${worker.availableFrom || '미정'} 부터${worker.workDuration ? ` (${WORK_DURATION_LABEL[worker.workDuration] || worker.workDuration})` : ''}</span>
      </div>
    `;
    card.addEventListener('click', () => openModal(worker.id));
    return card;
  }

  function renderWorkerList() {
    const filtered = getFilteredWorkers(workers, filterState);
    workerListEl.innerHTML = '';

    if (filtered.length === 0) {
      emptyMsgEl.hidden = false;
      emptyMsgEl.textContent = workers.length === 0
        ? '등록된 구직자가 없습니다. "구직 등록" 탭에서 자기 정보를 등록해보세요.'
        : '조건에 맞는 구직자가 없습니다. 필터를 변경해보세요.';
      return;
    }

    emptyMsgEl.hidden = true;
    const frag = document.createDocumentFragment();
    filtered.forEach((worker) => frag.appendChild(renderWorkerCard(worker)));
    workerListEl.appendChild(frag);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ---------- 필터바 이벤트 ----------
  function bindFilterEvents() {
    filterJobTypeEl.addEventListener('change', () => {
      filterState.jobType = filterJobTypeEl.value;
      renderWorkerList();
    });
    filterRegionEl.addEventListener('change', () => {
      filterState.regionMain = filterRegionEl.value;
      renderWorkerList();
    });
    filterAgeGroupEl.addEventListener('change', () => {
      filterState.ageGroup = filterAgeGroupEl.value;
      renderWorkerList();
    });
    filterSortEl.addEventListener('change', () => {
      filterState.sortKey = filterSortEl.value;
      renderWorkerList();
    });
  }

  // ---------- 탭 전환 ----------
  function switchTab(tab) {
    const isList = tab === 'list';
    tabListPanel.hidden = !isList;
    tabFormPanel.hidden = isList;
    tabListBtn.classList.toggle('active', isList);
    tabFormBtn.classList.toggle('active', !isList);
    tabListBtn.setAttribute('aria-selected', String(isList));
    tabFormBtn.setAttribute('aria-selected', String(!isList));
  }

  function bindTabEvents() {
    tabListBtn.addEventListener('click', () => switchTab('list'));
    tabFormBtn.addEventListener('click', () => switchTab('form'));
  }

  // ---------- 시세 가이드 (구직자가 자기 몸값을 시세에 맞게 책정하도록 안내) ----------
  function updateWageGuide() {
    const jobType = fJobType.value;
    const regionMain = fRegionMain.value;
    const wageType = fWageType.value;
    const wage = Number(fDesiredWage.value);

    if (!jobType || !regionMain) {
      wageGuideEl.textContent = '직종과 지역을 선택하면 다른 구직자들의 평균 희망일당을 안내합니다.';
      wageGuideEl.classList.remove('wage-warning');
      return;
    }

    if (wageType !== 'daily') {
      wageGuideEl.textContent = '일당 희망자 기준으로만 시세를 안내합니다. (월급 희망은 평균 계산에서 제외)';
      wageGuideEl.classList.remove('wage-warning');
      return;
    }

    const avg = getAverageWage(workers, jobType, regionMain);

    if (avg === null) {
      wageGuideEl.textContent = '아직 참고할 시세 데이터가 없습니다.';
      wageGuideEl.classList.remove('wage-warning');
      return;
    }

    const avgText = avg.toLocaleString('ko-KR');
    let msg = `이 직종/지역 다른 구직자 평균 희망일당: ${avgText}원`;
    let warning = false;

    if (fDesiredWage.value && wage > 0) {
      if (wage < avg * 0.7) {
        msg += ' — 낮음: 시세보다 낮게 등록하면 손해를 볼 수 있습니다.';
        warning = true;
      } else if (wage > avg * 1.5) {
        msg += ' — 참고: 시세보다 높아 컨택이 늦어질 수 있습니다.';
      }
    }

    wageGuideEl.textContent = msg;
    wageGuideEl.classList.toggle('wage-warning', warning);
  }

  function bindWageGuideEvents() {
    [fJobType, fRegionMain, fWageType].forEach((el) => {
      el.addEventListener('change', updateWageGuide);
    });
    fDesiredWage.addEventListener('input', updateWageGuide);
  }

  // ---------- 폼 검증/제출 ----------
  function clearErrors() {
    formEl.querySelectorAll('.error-msg').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
  }

  function showError(fieldName, message, focusEl) {
    const el = formEl.querySelector(`.error-msg[data-for="${fieldName}"]`);
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
    if (focusEl && !formEl._firstErrorFocused) {
      focusEl.focus();
      formEl._firstErrorFocused = true;
    }
  }

  function validateForm(data) {
    clearErrors();
    formEl._firstErrorFocused = false;
    let valid = true;

    if (!data.jobType) {
      showError('jobType', '희망 직종을 선택해주세요.', fJobType);
      valid = false;
    }
    if (!data.name || !data.name.trim()) {
      showError('name', '이름 또는 활동 별칭을 입력해주세요.', document.getElementById('f-name'));
      valid = false;
    }
    if (!data.age || Number(data.age) < 14 || Number(data.age) > 99) {
      showError('age', '나이는 만 14세~99세 범위로 입력해주세요.', document.getElementById('f-age'));
      valid = false;
    }
    if (!data.regionMain) {
      showError('regionMain', '활동 가능 광역 지역을 선택해주세요.', fRegionMain);
      valid = false;
    }
    if (!data.availableFrom) {
      showError('availableFrom', '근무 가능 시작일을 입력해주세요.', document.getElementById('f-availablefrom'));
      valid = false;
    }
    if (!data.desiredWage || Number(data.desiredWage) <= 0) {
      showError('desiredWage', '희망 금액은 0보다 큰 숫자여야 합니다.', fDesiredWage);
      valid = false;
    }
    if (!data.contact || !/^[0-9-]{7,}$/.test(data.contact.trim())) {
      showError('contact', '연락처는 숫자와 하이픈으로 7자리 이상 입력해주세요.', document.getElementById('f-contact'));
      valid = false;
    }

    return valid;
  }

  function resetForm() {
    formEl.reset();
    updateWageGuide();
  }

  function bindFormSubmit() {
    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      formToastEl.hidden = true;

      const data = {
        jobType: fJobType.value,
        name: document.getElementById('f-name').value,
        age: document.getElementById('f-age').value,
        career: document.getElementById('f-career').value,
        regionMain: fRegionMain.value,
        region: document.getElementById('f-region').value,
        availableFrom: document.getElementById('f-availablefrom').value,
        workDuration: document.getElementById('f-workduration').value,
        wageType: fWageType.value,
        desiredWage: fDesiredWage.value,
        contact: document.getElementById('f-contact').value,
        selfIntro: document.getElementById('f-selfintro').value,
        verified: document.getElementById('f-verified').checked,
      };

      if (!validateForm(data)) return;

      const newWorker = {
        id: (crypto.randomUUID ? crypto.randomUUID() : `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        jobType: data.jobType,
        name: data.name.trim(),
        age: Number(data.age),
        career: data.career.trim(),
        regionMain: data.regionMain,
        region: data.region.trim(),
        availableFrom: data.availableFrom,
        workDuration: data.workDuration || '',
        desiredWage: Number(data.desiredWage),
        wageType: data.wageType,
        contact: data.contact.trim(),
        selfIntro: data.selfIntro.trim(),
        createdAt: new Date().toISOString(),
        verified: !!data.verified,
      };

      workers.push(newWorker);
      saveWorkers(workers);

      resetForm();
      switchTab('list');
      renderWorkerList();

      formToastEl.textContent = '구직 정보가 등록되었습니다. 이제 구인업체가 인력 목록에서 확인할 수 있습니다.';
      formToastEl.hidden = false;
      setTimeout(() => { formToastEl.hidden = true; }, 3500);
    });
  }

  // ---------- 상세보기 모달 (구인업체 시점) ----------
  function openModal(workerId) {
    const worker = workers.find((w) => w.id === workerId);
    if (!worker) return;

    lastFocusedEl = document.activeElement;

    const verifiedBadge = worker.verified ? '<span class="badge badge-verified">✓ 인증 인력</span>' : '';
    modalBadges.innerHTML = `<span class="badge">${getJobTypeLabel(worker.jobType)}</span>${verifiedBadge}`;
    modalTitle.textContent = `${worker.name} (${worker.age}세)`;

    const region = worker.region ? `${worker.region} (${worker.regionMain})` : worker.regionMain;
    const duration = worker.workDuration ? (WORK_DURATION_LABEL[worker.workDuration] || worker.workDuration) : '미정';

    modalBody.innerHTML = `
      <dt>활동 지역</dt><dd>${escapeHtml(region)}</dd>
      <dt>경력/숙련도</dt><dd>${worker.career ? escapeHtml(worker.career) : '정보 없음'}</dd>
      <dt>희망 급여</dt><dd>${formatWage(worker)}</dd>
      <dt>근무 가능</dt><dd>${worker.availableFrom || '미정'} 부터 (${duration})</dd>
      <dt>자기소개</dt><dd>${worker.selfIntro ? escapeHtml(worker.selfIntro) : '별도 소개가 없습니다.'}</dd>
    `;

    // 컨택하기 플로우: 모달을 열 때마다 연락처 영역은 숨김 상태로 리셋
    contactArea.hidden = true;
    contactArea.innerHTML = '';
    contactBtn.disabled = false;
    contactBtn.textContent = '컨택하기';

    contactBtn.onclick = () => {
      contactArea.innerHTML = `<p><strong>연락처:</strong> ${escapeHtml(worker.contact)}</p>`;
      contactArea.hidden = false;
      contactBtn.textContent = '연락처 확인됨';
      contactBtn.disabled = true;
    };

    modalOverlay.hidden = false;
    modalClose.focus();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
  }

  function bindModalEvents() {
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (event) => {
      if (event.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modalOverlay.hidden) closeModal();
    });
  }

  // ---------- 내보내기 / 가져오기 ----------
  function bindExportImport() {
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(workers, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `construction-jobs-workers-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', () => {
      const file = importFile.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed)) throw new Error('배열 형식이 아닙니다.');
        } catch (err) {
          alert('가져오기 실패: 올바른 JSON 구직 프로필 파일이 아닙니다.');
          importFile.value = '';
          return;
        }

        const incoming = parsed.map((w) => ({
          ...w,
          verified: typeof w.verified === 'boolean' ? w.verified : false,
        }));

        const merge = confirm(
          `${incoming.length}건의 구직 프로필을 가져왔습니다.\n\n[확인] = 기존 목록과 병합(같은 id는 덮어쓰기)\n[취소] = 기존 목록을 이 파일로 전체 교체`
        );

        if (merge) {
          const byId = new Map(workers.map((w) => [w.id, w]));
          incoming.forEach((w) => byId.set(w.id, w));
          workers = Array.from(byId.values());
        } else {
          workers = incoming;
        }

        saveWorkers(workers);
        renderWorkerList();
        importFile.value = '';
        alert('가져오기가 완료되었습니다.');
      };
      reader.readAsText(file);
    });
  }

  // ---------- 다크모드 ----------
  const THEME_KEY = 'construction-jobs-theme';

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    themeToggle.textContent = getEffectiveTheme() === 'dark' ? '☀️' : '🌙';
  }

  function getEffectiveTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved);

    themeToggle.addEventListener('click', () => {
      const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  // ---------- 안내 박스 접기/펼치기 ----------
  const GUIDE_KEY = 'construction-jobs-guide-collapsed';

  function initGuideBox() {
    const collapsed = localStorage.getItem(GUIDE_KEY) === 'true';
    setGuideCollapsed(collapsed);

    guideToggle.addEventListener('click', () => {
      const isCollapsed = guideBox.classList.contains('collapsed');
      setGuideCollapsed(!isCollapsed);
      localStorage.setItem(GUIDE_KEY, String(!isCollapsed));
    });
  }

  function setGuideCollapsed(collapsed) {
    guideBox.classList.toggle('collapsed', collapsed);
    guideContent.hidden = collapsed;
    guideToggle.setAttribute('aria-expanded', String(!collapsed));
    guideToggleLabel.textContent = collapsed ? '사용법 안내 다시 보기' : '사용법 안내 닫기';
  }

  // ---------- 초기화 ----------
  function init() {
    populateJobTypeSelects();
    populateRegionSelects();
    bindFilterEvents();
    bindTabEvents();
    bindWageGuideEvents();
    bindFormSubmit();
    bindModalEvents();
    bindExportImport();
    initTheme();
    initGuideBox();

    updateWageGuide();
    renderWorkerList();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
