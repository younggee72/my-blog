// app.js — 사내 포털: 허브 카드는 정적 마크업(index.html)이므로 별도 렌더링 없음.
// 진행중인 현장 목록/상세 렌더링, 폼 입력/검증, CRUD, 차량 선택 UI, 다크모드 토글.

(function () {
  'use strict';

  // ---------- 상태 ----------
  let sites = loadSites();
  let currentDetailSiteId = null;
  let lastFocusedEl = null;

  // ---------- 요소 참조 ----------
  const themeToggle = document.getElementById('theme-toggle');
  const desktopShortcutBtn = document.getElementById('desktop-shortcut-btn');
  const installGuideOverlay = document.getElementById('install-guide-overlay');
  const installGuideClose = document.getElementById('install-guide-close');
  const installGuideOkBtn = document.getElementById('install-guide-ok-btn');
  const guideBox = document.getElementById('guide-box');
  const guideToggle = document.getElementById('guide-toggle');
  const guideContent = document.getElementById('guide-content');
  const guideToggleLabel = document.getElementById('guide-toggle-label');

  const siteListEl = document.getElementById('site-list');
  const siteEmptyMsgEl = document.getElementById('site-empty-msg');
  const siteCountEl = document.getElementById('site-count');
  const addSiteBtn = document.getElementById('add-site-btn');

  // 현장 폼
  const siteFormPanel = document.getElementById('site-form-panel');
  const siteFormTitle = document.getElementById('site-form-title');
  const siteForm = document.getElementById('site-form');
  const siteIdInput = document.getElementById('site-id');
  const siteNameInput = document.getElementById('site-name');
  const siteAddressInput = document.getElementById('site-address');
  const siteStartDateInput = document.getElementById('site-startdate');
  const siteEndDateInput = document.getElementById('site-enddate');
  const siteManagerInput = document.getElementById('site-manager');
  const siteStageSelect = document.getElementById('site-stage');
  const siteProgressInput = document.getElementById('site-progress');
  const siteProgressRange = document.getElementById('site-progress-range');
  const siteContractInput = document.getElementById('site-contract');
  const siteBilledInput = document.getElementById('site-billed');
  const siteCollectedInput = document.getElementById('site-collected');
  const siteVehicleChecklistEl = document.getElementById('site-vehicle-checklist');
  const siteVehicleEmptyMsgEl = document.getElementById('site-vehicle-empty-msg');
  const siteVehicleFreeTextInput = document.getElementById('site-vehicle-freetext');
  const siteMemoInput = document.getElementById('site-memo');
  const siteFormCancelBtn = document.getElementById('site-form-cancel');
  const siteFormToast = document.getElementById('site-form-toast');

  // 접근 제어(비밀번호 잠금)
  const internalArea = document.getElementById('internal-area');
  const unlockBtn = document.getElementById('unlock-btn');
  const passwordModalOverlay = document.getElementById('password-modal-overlay');
  const passwordModalClose = document.getElementById('password-modal-close');
  const passwordForm = document.getElementById('password-form');
  const passwordInput = document.getElementById('password-input');
  const passwordErrorMsg = document.getElementById('password-error-msg');
  const passwordSubmitBtn = document.getElementById('password-submit-btn');
  const passwordCancelBtn = document.getElementById('password-cancel-btn');

  // 상세 모달
  const siteDetailOverlay = document.getElementById('site-detail-overlay');
  const siteDetailClose = document.getElementById('site-detail-close');
  const siteDetailTitle = document.getElementById('site-detail-title');
  const siteDetailMeta = document.getElementById('site-detail-meta');
  const siteDetailProgressFill = document.getElementById('site-detail-progress-fill');
  const siteDetailProgressLabel = document.getElementById('site-detail-progress-label');
  const siteDetailContract = document.getElementById('site-detail-contract');
  const siteDetailBilled = document.getElementById('site-detail-billed');
  const siteDetailCollected = document.getElementById('site-detail-collected');
  const siteDetailVehicles = document.getElementById('site-detail-vehicles');
  const siteDetailVehiclesEmpty = document.getElementById('site-detail-vehicles-empty');
  const siteDetailMemo = document.getElementById('site-detail-memo');
  const siteDetailEditBtn = document.getElementById('site-detail-edit-btn');
  const siteDetailDeleteBtn = document.getElementById('site-detail-delete-btn');

  // ---------- 공통 헬퍼 ----------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function showFieldError(formEl, fieldName, message) {
    const el = formEl.querySelector(`.error-msg[data-for="${fieldName}"]`);
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  }

  function clearFieldErrors(formEl) {
    formEl.querySelectorAll('.error-msg').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
  }

  function formatDateRange(startDate, endDate) {
    const start = startDate || '미정';
    const end = endDate || '미정';
    return `${start} ~ ${end}`;
  }

  function populateStageSelect() {
    siteStageSelect.innerHTML = SITE_STAGES.map(
      (s) => `<option value="${s.id}">${s.icon} ${escapeHtml(s.label)}</option>`
    ).join('');
  }

  // ---------- 현장 목록 렌더링 (금액 정보는 표시하지 않음) ----------

  function renderSiteList() {
    siteCountEl.textContent = `등록된 현장 ${sites.length}건`;

    if (sites.length === 0) {
      siteListEl.innerHTML = '';
      siteEmptyMsgEl.hidden = false;
      return;
    }
    siteEmptyMsgEl.hidden = true;

    siteListEl.innerHTML = sites.map((site) => {
      const stage = getSiteStage(site.stage);
      const stageLabel = stage ? `${stage.icon} ${stage.label}` : '단계 미지정';
      const progress = Math.max(0, Math.min(100, Number(site.progressPercent) || 0));
      return `
        <button type="button" class="site-card" data-site-id="${escapeHtml(site.id)}">
          <div class="site-card-top">
            <p class="site-card-name">${escapeHtml(site.name)}</p>
            <span class="badge">${escapeHtml(stageLabel)}</span>
          </div>
          <div class="site-card-meta">📍 ${escapeHtml(site.address)} · 담당 ${escapeHtml(site.manager)}</div>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
          <div class="site-card-dates">${escapeHtml(formatDateRange(site.startDate, site.endDatePlanned))} · 공정률 ${progress}%</div>
        </button>
      `;
    }).join('');

    siteListEl.querySelectorAll('.site-card').forEach((card) => {
      card.addEventListener('click', () => openDetail(card.dataset.siteId));
    });
  }

  // ---------- 상세 모달 (금액 정보 + 투입 차량은 여기서만 노출) ----------

  function openDetail(siteId) {
    const site = getSiteById(sites, siteId);
    if (!site) return;
    currentDetailSiteId = siteId;

    const stage = getSiteStage(site.stage);
    const progress = Math.max(0, Math.min(100, Number(site.progressPercent) || 0));

    siteDetailTitle.textContent = site.name;
    siteDetailMeta.textContent = `📍 ${site.address} · 담당 ${site.manager} · ${formatDateRange(site.startDate, site.endDatePlanned)}`;
    siteDetailProgressFill.style.width = `${progress}%`;
    siteDetailProgressLabel.textContent = `${stage ? stage.icon + ' ' + stage.label : '단계 미지정'} · 공정률 ${progress}%`;

    siteDetailContract.textContent = formatAmount(site.contractAmount);
    siteDetailBilled.textContent = formatAmount(site.billedAmount);
    siteDetailCollected.textContent = formatAmount(site.collectedAmount);

    const fleetVehicles = getVehicleFleetVehiclesReadOnly();
    const plateTags = (Array.isArray(site.vehiclePlates) ? site.vehiclePlates : []).map((plate) => {
      const match = fleetVehicles.find((v) => v.plateNumber === plate);
      const typeLabel = match ? ` (${escapeHtml(String(match.vehicleType || ''))})` : '';
      return `<li>${escapeHtml(plate)}${typeLabel}</li>`;
    });
    const hasFreeText = !!(site.vehicleFreeText && site.vehicleFreeText.trim());
    if (hasFreeText) {
      plateTags.push(`<li>${escapeHtml(site.vehicleFreeText)}</li>`);
    }
    siteDetailVehicles.innerHTML = plateTags.join('');
    siteDetailVehiclesEmpty.hidden = plateTags.length > 0;

    if (site.memo && site.memo.trim()) {
      siteDetailMemo.textContent = `비고: ${site.memo}`;
      siteDetailMemo.hidden = false;
    } else {
      siteDetailMemo.hidden = true;
    }

    lastFocusedEl = document.activeElement;
    siteDetailOverlay.hidden = false;
    siteDetailClose.focus();
  }

  function closeDetail() {
    siteDetailOverlay.hidden = true;
    currentDetailSiteId = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  }

  // ---------- 차량 선택 체크리스트 ----------

  function renderVehicleChecklist(selectedPlates) {
    const fleetVehicles = getVehicleFleetVehiclesReadOnly();
    const selected = new Set(Array.isArray(selectedPlates) ? selectedPlates : []);

    if (fleetVehicles.length === 0) {
      siteVehicleChecklistEl.innerHTML = '';
      siteVehicleEmptyMsgEl.hidden = false;
      return;
    }
    siteVehicleEmptyMsgEl.hidden = true;

    siteVehicleChecklistEl.innerHTML = fleetVehicles.map((v) => {
      const plate = v.plateNumber;
      const checked = selected.has(plate) ? 'checked' : '';
      const typeLabel = v.vehicleType ? ` (${escapeHtml(String(v.vehicleType))})` : '';
      return `
        <label>
          <input type="checkbox" class="site-vehicle-checkbox" value="${escapeHtml(plate)}" ${checked}>
          ${escapeHtml(plate)}${typeLabel}
        </label>
      `;
    }).join('');
  }

  function getCheckedVehiclePlates() {
    return Array.from(siteVehicleChecklistEl.querySelectorAll('.site-vehicle-checkbox:checked')).map((el) => el.value);
  }

  // ---------- 폼 열기/닫기 ----------

  function openSiteForm(site) {
    clearFieldErrors(siteForm);
    siteFormToast.hidden = true;

    const isEdit = !!site;
    siteFormTitle.textContent = isEdit ? '현장 수정' : '새 현장 등록';
    const data = site || createEmptySite();

    siteIdInput.value = data.id || '';
    siteNameInput.value = data.name || '';
    siteAddressInput.value = data.address || '';
    siteStartDateInput.value = data.startDate || '';
    siteEndDateInput.value = data.endDatePlanned || '';
    siteManagerInput.value = data.manager || '';
    siteStageSelect.value = data.stage || 'before-start';
    const progress = Number(data.progressPercent) || 0;
    siteProgressInput.value = progress;
    siteProgressRange.value = progress;
    siteContractInput.value = data.contractAmount || 0;
    siteBilledInput.value = data.billedAmount || 0;
    siteCollectedInput.value = data.collectedAmount || 0;
    siteVehicleFreeTextInput.value = data.vehicleFreeText || '';
    siteMemoInput.value = data.memo || '';

    renderVehicleChecklist(data.vehiclePlates);

    siteFormPanel.hidden = false;
    siteFormPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeSiteForm() {
    siteFormPanel.hidden = true;
    siteForm.reset();
    clearFieldErrors(siteForm);
  }

  // ---------- 진행 단계 -> 공정률 프리필 ----------

  function bindStagePrefill() {
    siteStageSelect.addEventListener('change', () => {
      const stage = getSiteStage(siteStageSelect.value);
      if (!stage) return;
      siteProgressInput.value = stage.progressHint;
      siteProgressRange.value = stage.progressHint;
    });

    siteProgressInput.addEventListener('input', () => {
      siteProgressRange.value = siteProgressInput.value;
    });
    siteProgressRange.addEventListener('input', () => {
      siteProgressInput.value = siteProgressRange.value;
    });
  }

  // ---------- 폼 제출(등록/수정) ----------

  function bindSiteForm() {
    addSiteBtn.addEventListener('click', () => openSiteForm(null));
    siteFormCancelBtn.addEventListener('click', closeSiteForm);

    siteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldErrors(siteForm);
      siteFormToast.hidden = true;

      const name = siteNameInput.value.trim();
      const address = siteAddressInput.value.trim();
      const startDate = siteStartDateInput.value;
      const manager = siteManagerInput.value.trim();

      let hasError = false;
      if (!name) {
        showFieldError(siteForm, 'name', '현장명을 입력해주세요.');
        hasError = true;
      }
      if (!address) {
        showFieldError(siteForm, 'address', '위치(주소)를 입력해주세요.');
        hasError = true;
      }
      if (!startDate) {
        showFieldError(siteForm, 'startdate', '착공일을 입력해주세요.');
        hasError = true;
      }
      if (!manager) {
        showFieldError(siteForm, 'manager', '담당자를 입력해주세요.');
        hasError = true;
      }
      if (hasError) return;

      const id = siteIdInput.value;
      const isEdit = !!id;
      const now = new Date().toISOString();
      const progress = Math.max(0, Math.min(100, Number(siteProgressInput.value) || 0));

      const siteData = {
        id: isEdit ? id : generateId('site'),
        name,
        address,
        startDate,
        endDatePlanned: siteEndDateInput.value || '',
        manager,
        progressPercent: progress,
        stage: siteStageSelect.value || 'before-start',
        contractAmount: Math.max(0, Number(siteContractInput.value) || 0),
        billedAmount: Math.max(0, Number(siteBilledInput.value) || 0),
        collectedAmount: Math.max(0, Number(siteCollectedInput.value) || 0),
        vehiclePlates: getCheckedVehiclePlates(),
        vehicleFreeText: siteVehicleFreeTextInput.value.trim(),
        memo: siteMemoInput.value.trim(),
        createdAt: isEdit ? (getSiteById(sites, id) || {}).createdAt || now : now,
        updatedAt: now,
      };

      if (isEdit) {
        sites = sites.map((s) => (s.id === id ? siteData : s));
      } else {
        sites = [siteData, ...sites];
      }
      saveSites(sites);
      renderSiteList();

      siteFormToast.hidden = false;
      siteFormToast.textContent = isEdit ? '현장 정보를 수정했습니다.' : '새 현장을 등록했습니다.';
      setTimeout(() => {
        closeSiteForm();
      }, 700);
    });
  }

  // ---------- 상세 모달의 수정/삭제 ----------

  function bindDetailModal() {
    siteDetailClose.addEventListener('click', closeDetail);
    siteDetailOverlay.addEventListener('click', (event) => {
      if (event.target === siteDetailOverlay) closeDetail();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !siteDetailOverlay.hidden) closeDetail();
    });

    siteDetailEditBtn.addEventListener('click', () => {
      const site = getSiteById(sites, currentDetailSiteId);
      if (!site) return;
      closeDetail();
      openSiteForm(site);
    });

    siteDetailDeleteBtn.addEventListener('click', () => {
      const site = getSiteById(sites, currentDetailSiteId);
      if (!site) return;
      const ok = confirm(`"${site.name}" 현장을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
      if (!ok) return;
      sites = sites.filter((s) => s.id !== site.id);
      saveSites(sites);
      renderSiteList();
      closeDetail();
    });
  }

  // ---------- 다크모드 ----------

  const THEME_KEY = 'company-portal-theme';

  function getEffectiveTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    themeToggle.textContent = getEffectiveTheme() === 'dark' ? '☀️' : '🌙';
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

  // ---------- 바탕화면에 설치(PWA) ----------

  let deferredInstallPrompt = null;

  function openInstallGuide() {
    installGuideOverlay.hidden = false;
  }

  function closeInstallGuide() {
    installGuideOverlay.hidden = true;
  }

  function initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });

    desktopShortcutBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch (err) {
          // 사용자가 설치 대화상자를 닫은 경우 등 — 무시
        }
        deferredInstallPrompt = null;
      } else {
        openInstallGuide();
      }
    });

    installGuideClose.addEventListener('click', closeInstallGuide);
    installGuideOkBtn.addEventListener('click', closeInstallGuide);
    installGuideOverlay.addEventListener('click', (event) => {
      if (event.target === installGuideOverlay) closeInstallGuide();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
    });
  }

  // ---------- 접근 제어(비밀번호 잠금) ----------

  let lastFocusedElBeforePasswordModal = null;

  function openPasswordModal() {
    passwordErrorMsg.hidden = true;
    passwordInput.value = '';
    lastFocusedElBeforePasswordModal = document.activeElement;
    passwordModalOverlay.hidden = false;
    passwordInput.focus();
  }

  function closePasswordModal() {
    passwordModalOverlay.hidden = true;
    passwordForm.reset();
    passwordErrorMsg.hidden = true;
    if (lastFocusedElBeforePasswordModal && typeof lastFocusedElBeforePasswordModal.focus === 'function') {
      lastFocusedElBeforePasswordModal.focus();
    }
  }

  function showInternalArea() {
    internalArea.hidden = false;
    unlockBtn.textContent = '🔓 잠금 해제됨 (다시 잠그기)';
  }

  function hideInternalArea() {
    internalArea.hidden = true;
    unlockBtn.textContent = '🔒 직원 전용 업무 시스템';
  }

  function initAccessControl() {
    if (isUnlocked()) {
      showInternalArea();
    }

    unlockBtn.addEventListener('click', () => {
      if (isUnlocked()) {
        lockAgain();
        hideInternalArea();
      } else {
        openPasswordModal();
      }
    });

    passwordModalClose.addEventListener('click', closePasswordModal);
    passwordCancelBtn.addEventListener('click', closePasswordModal);
    passwordModalOverlay.addEventListener('click', (event) => {
      if (event.target === passwordModalOverlay) closePasswordModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !passwordModalOverlay.hidden) closePasswordModal();
    });

    passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      passwordErrorMsg.hidden = true;
      passwordSubmitBtn.disabled = true;

      verifyPassword(passwordInput.value)
        .then((ok) => {
          if (ok) {
            setUnlocked();
            closePasswordModal();
            showInternalArea();
          } else {
            passwordErrorMsg.hidden = false;
            passwordInput.focus();
            passwordInput.select();
          }
        })
        .catch((err) => {
          console.warn('[company-portal] 비밀번호 확인 중 오류가 발생했습니다.', err);
          passwordErrorMsg.hidden = false;
        })
        .finally(() => {
          passwordSubmitBtn.disabled = false;
        });
    });
  }

  // ---------- 사용법 안내 박스 ----------

  const GUIDE_KEY = 'company-portal-guide-collapsed';

  function setGuideCollapsed(collapsed) {
    guideBox.classList.toggle('collapsed', collapsed);
    guideContent.hidden = collapsed;
    guideToggle.setAttribute('aria-expanded', String(!collapsed));
    guideToggleLabel.textContent = collapsed ? '사용법 안내 다시 보기' : '사용법 안내 닫기';
  }

  function initGuideBox() {
    const collapsed = localStorage.getItem(GUIDE_KEY) === 'true';
    setGuideCollapsed(collapsed);
    guideToggle.addEventListener('click', () => {
      const isCollapsed = guideBox.classList.contains('collapsed');
      setGuideCollapsed(!isCollapsed);
      localStorage.setItem(GUIDE_KEY, String(!isCollapsed));
    });
  }

  // ---------- 초기화 ----------

  function init() {
    initTheme();
    initInstallPrompt();
    initGuideBox();
    initAccessControl();
    populateStageSelect();
    bindStagePrefill();
    bindSiteForm();
    bindDetailModal();
    renderSiteList();
  }

  init();
})();
