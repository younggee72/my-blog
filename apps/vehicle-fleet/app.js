// app.js — DOM 렌더링(대시보드, 차량상세), 폼 입력 처리/검증, 화면 전환,
// 내보내기/가져오기, 다크모드, 알림(웹훅) 설정/발송 트리거

(function () {
  'use strict';

  // ---------- 상태 ----------
  let vehicles = loadVehicles();
  let schedules = loadSchedules();
  let consumables = loadConsumables();
  let currentDetailVehicleId = null;

  // ---------- 요소 참조 ----------
  const themeToggle = document.getElementById('theme-toggle');
  const guideBox = document.getElementById('guide-box');
  const guideToggle = document.getElementById('guide-toggle');
  const guideContent = document.getElementById('guide-content');
  const guideToggleLabel = document.getElementById('guide-toggle-label');

  const screenDashboard = document.getElementById('screen-dashboard');
  const screenDetail = document.getElementById('screen-detail');

  const summaryBarEl = document.getElementById('summary-bar');
  const vehicleListEl = document.getElementById('vehicle-list');
  const dashboardEmptyMsgEl = document.getElementById('dashboard-empty-msg');

  const addVehicleBtn = document.getElementById('add-vehicle-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  const notifySettingsBtn = document.getElementById('notify-settings-btn');
  const notifyOffDot = document.getElementById('notify-off-dot');

  const backToDashboardBtn = document.getElementById('back-to-dashboard');
  const detailPlateEl = document.getElementById('detail-plate');
  const detailMetaEl = document.getElementById('detail-meta');
  const detailNoteEl = document.getElementById('detail-note');
  const detailEditBtn = document.getElementById('detail-edit-btn');
  const detailDeleteBtn = document.getElementById('detail-delete-btn');

  // 차량 폼
  const vehicleFormPanel = document.getElementById('vehicle-form-panel');
  const vehicleFormTitle = document.getElementById('vehicle-form-title');
  const vehicleForm = document.getElementById('vehicle-form');
  const vehicleIdInput = document.getElementById('vehicle-id');
  const vehiclePlateInput = document.getElementById('vehicle-plate');
  const vehicleTypeSelect = document.getElementById('vehicle-type');
  const vehicleModelInput = document.getElementById('vehicle-model');
  const vehicleDriverInput = document.getElementById('vehicle-driver');
  const vehicleFirstRegisteredInput = document.getElementById('vehicle-first-registered');
  const vehicleOdometerInput = document.getElementById('vehicle-odometer');
  const vehicleOdometerHint = document.getElementById('vehicle-odometer-hint');
  const vehicleNoteInput = document.getElementById('vehicle-note');
  const vehicleAutoConsumablesField = document.getElementById('vehicle-auto-consumables-field');
  const vehicleAutoConsumablesCheckbox = document.getElementById('vehicle-auto-consumables');
  const vehicleFormCancelBtn = document.getElementById('vehicle-form-cancel');
  const vehicleFormToast = document.getElementById('vehicle-form-toast');

  // 검사/보험 폼
  const addScheduleBtn = document.getElementById('add-schedule-btn');
  const scheduleFormPanel = document.getElementById('schedule-form-panel');
  const scheduleFormTitle = document.getElementById('schedule-form-title');
  const scheduleForm = document.getElementById('schedule-form');
  const scheduleIdInput = document.getElementById('schedule-id');
  const scheduleCategorySelect = document.getElementById('schedule-category');
  const scheduleLabelInput = document.getElementById('schedule-label');
  const insurancePresetsDatalist = document.getElementById('insurance-presets');
  const scheduleInsurerField = document.getElementById('schedule-insurer-field');
  const scheduleInsurerInput = document.getElementById('schedule-insurer');
  const scheduleLastDateInput = document.getElementById('schedule-lastdate');
  const scheduleOverrideToggle = document.getElementById('schedule-override-toggle');
  const scheduleCycleMonthsField = document.getElementById('schedule-cyclemonths-field');
  const scheduleCycleMonthsInput = document.getElementById('schedule-cyclemonths');
  const scheduleNextDateField = document.getElementById('schedule-nextdate-field');
  const scheduleNextDateInput = document.getElementById('schedule-nextdate');
  const scheduleNoteInput = document.getElementById('schedule-note');
  const scheduleFormCancelBtn = document.getElementById('schedule-form-cancel');
  const scheduleFormToast = document.getElementById('schedule-form-toast');
  const scheduleListEl = document.getElementById('schedule-list');
  const scheduleEmptyMsgEl = document.getElementById('schedule-empty-msg');

  // 소모품 폼
  const addConsumableBtn = document.getElementById('add-consumable-btn');
  const consumableFormPanel = document.getElementById('consumable-form-panel');
  const consumableFormTitle = document.getElementById('consumable-form-title');
  const consumableForm = document.getElementById('consumable-form');
  const consumableIdInput = document.getElementById('consumable-id');
  const consumableItemTypeSelect = document.getElementById('consumable-itemtype');
  const consumableCustomLabelField = document.getElementById('consumable-customlabel-field');
  const consumableCustomLabelInput = document.getElementById('consumable-customlabel');
  const consumableLastDateInput = document.getElementById('consumable-lastdate');
  const consumableLastOdometerInput = document.getElementById('consumable-lastodometer');
  const consumableCycleMonthsInput = document.getElementById('consumable-cyclemonths');
  const consumableCycleKmInput = document.getElementById('consumable-cyclekm');
  const consumableNoteInput = document.getElementById('consumable-note');
  const consumableFormCancelBtn = document.getElementById('consumable-form-cancel');
  const consumableFormToast = document.getElementById('consumable-form-toast');
  const consumableListEl = document.getElementById('consumable-list');
  const consumableEmptyMsgEl = document.getElementById('consumable-empty-msg');

  // 알림 설정 모달
  const notifyModalOverlay = document.getElementById('notify-modal-overlay');
  const notifyModalClose = document.getElementById('notify-modal-close');
  const notifyWebhookUrlInput = document.getElementById('notify-webhook-url');
  const notifyEnabledCheckbox = document.getElementById('notify-enabled');
  const notifyUrlWarning = document.getElementById('notify-url-warning');
  const notifyTestBtn = document.getElementById('notify-test-btn');
  const notifySaveBtn = document.getElementById('notify-save-btn');
  const notifyTestResult = document.getElementById('notify-test-result');
  const notifyFailNote = document.getElementById('notify-fail-note');

  let lastFocusedEl = null;

  // ---------- 공통 헬퍼 ----------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatKm(n) {
    return Number(n).toLocaleString('ko-KR') + 'km';
  }

  function statusBadgeHtml(status) {
    const map = {
      overdue: ['badge-overdue', '경과'],
      'due-soon': ['badge-due-soon', '임박'],
      ok: ['badge-ok', '정상'],
      unknown: ['badge-unknown', '미입력'],
    };
    const pair = map[status] || map.unknown;
    return `<span class="badge ${pair[0]}">${pair[1]}</span>`;
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

  // ---------- select/datalist 옵션 채우기 ----------

  function populateVehicleTypeSelect() {
    vehicleTypeSelect.innerHTML = VEHICLE_TYPES.map(
      (t) => `<option value="${t.id}">${t.icon} ${escapeHtml(t.label)}</option>`
    ).join('');
  }

  function populateConsumableTypeSelect() {
    consumableItemTypeSelect.innerHTML = CONSUMABLE_TYPES.map(
      (t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`
    ).join('');
  }

  function populateInsurancePresets() {
    insurancePresetsDatalist.innerHTML = INSURANCE_LABEL_PRESETS.map(
      (label) => `<option value="${escapeHtml(label)}"></option>`
    ).join('');
  }

  // ---------- 화면 전환 ----------

  function showScreen(name) {
    const isDashboard = name === 'dashboard';
    screenDashboard.hidden = !isDashboard;
    screenDetail.hidden = isDashboard;
  }

  function openDetail(vehicleId) {
    currentDetailVehicleId = vehicleId;
    closeVehicleForm();
    closeScheduleForm();
    closeConsumableForm();
    showScreen('detail');
    renderDetailScreen(vehicleId);
    screenDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToDashboard() {
    currentDetailVehicleId = null;
    closeVehicleForm();
    showScreen('dashboard');
    renderDashboard();
  }

  // ---------- 대시보드 렌더링 ----------

  function renderSummaryBar() {
    const summary = getFleetSummary(vehicles, schedules, consumables);
    summaryBarEl.innerHTML = `
      <div class="summary-tile"><span class="num">${summary.totalVehicles}</span><span class="label">전체 차량</span></div>
      <div class="summary-tile due-soon"><span class="num">${summary.scheduleDueSoon}</span><span class="label">검사/보험 임박</span></div>
      <div class="summary-tile overdue"><span class="num">${summary.scheduleOverdue}</span><span class="label">검사/보험 경과</span></div>
      <div class="summary-tile due-soon"><span class="num">${summary.consumableDueSoon}</span><span class="label">소모품 임박</span></div>
      <div class="summary-tile overdue"><span class="num">${summary.consumableOverdue}</span><span class="label">소모품 경과</span></div>
    `;
  }

  function renderVehicleCard(vehicle) {
    const typeInfo = getVehicleType(vehicle.vehicleType);
    const status = getVehicleWorstStatus(vehicle.id, schedules, consumables, vehicle.currentOdometer);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'vehicle-card';
    card.setAttribute('data-vehicle-id', vehicle.id);
    card.innerHTML = `
      <div class="vehicle-card-top">
        <span class="vehicle-card-icon">${typeInfo ? typeInfo.icon : '🚙'}</span>
        ${statusBadgeHtml(status)}
      </div>
      <p class="vehicle-card-plate">${escapeHtml(vehicle.plateNumber)}</p>
      <div class="vehicle-card-meta">
        <span>${typeInfo ? escapeHtml(typeInfo.label) : ''}</span>
        ${vehicle.driver ? ` · 담당자: ${escapeHtml(vehicle.driver)}` : ''}
      </div>
    `;
    card.addEventListener('click', () => openDetail(vehicle.id));
    return card;
  }

  function renderVehicleList() {
    vehicleListEl.innerHTML = '';
    if (vehicles.length === 0) {
      dashboardEmptyMsgEl.hidden = false;
      return;
    }
    dashboardEmptyMsgEl.hidden = true;
    const frag = document.createDocumentFragment();
    vehicles.forEach((v) => frag.appendChild(renderVehicleCard(v)));
    vehicleListEl.appendChild(frag);
  }

  function renderDashboard() {
    renderSummaryBar();
    renderVehicleList();
  }

  function refreshAll() {
    renderSummaryBar();
    renderVehicleList();
    if (currentDetailVehicleId) {
      const stillExists = vehicles.some((v) => v.id === currentDetailVehicleId);
      if (stillExists) {
        renderDetailScreen(currentDetailVehicleId);
      } else {
        backToDashboard();
      }
    }
  }

  // ---------- 차량 상세 화면 렌더링 ----------

  function renderDetailScreen(vehicleId) {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) {
      backToDashboard();
      return;
    }
    const typeInfo = getVehicleType(vehicle.vehicleType);
    detailPlateEl.textContent = `${typeInfo ? typeInfo.icon + ' ' : ''}${vehicle.plateNumber}`;

    const metaParts = [
      typeInfo ? typeInfo.label : vehicle.vehicleType,
      `담당자: ${vehicle.driver || '미지정'}`,
      `모델: ${vehicle.modelName || '-'}`,
      `최초등록일: ${vehicle.firstRegisteredDate || '미입력'}`,
      vehicle.currentOdometer != null ? `현재 ${formatKm(vehicle.currentOdometer)}` : '주행거리 미입력',
    ];
    detailMetaEl.textContent = metaParts.join(' · ');

    if (vehicle.note) {
      detailNoteEl.textContent = `비고: ${vehicle.note}`;
      detailNoteEl.hidden = false;
    } else {
      detailNoteEl.hidden = true;
    }

    renderScheduleList(vehicle);
    renderConsumableList(vehicle);
  }

  // ---------- 검사/보험 목록 렌더링 ----------

  function renderScheduleList(vehicle) {
    const items = schedules.filter((s) => s.vehicleId === vehicle.id);
    scheduleListEl.innerHTML = '';
    if (items.length === 0) {
      scheduleEmptyMsgEl.hidden = false;
      return;
    }
    scheduleEmptyMsgEl.hidden = true;

    const frag = document.createDocumentFragment();
    items.forEach((s) => {
      const status = getItemStatus(s, vehicle.currentOdometer);
      const dueDate = getNextDueDate(s);
      const categoryLabel = s.category === 'inspection' ? '정기검사' : '보험';

      const card = document.createElement('div');
      card.className = 'item-card';
      card.setAttribute('data-schedule-id', s.id);
      card.innerHTML = `
        <div class="item-card-top">
          <span class="item-card-title">${escapeHtml(s.label)}</span>
          ${statusBadgeHtml(status)}
        </div>
        <div class="item-card-meta">
          <span>구분: ${categoryLabel}</span>
          ${s.category === 'insurance' && s.insurer ? `<span>보험사: ${escapeHtml(s.insurer)}</span>` : ''}
          <span>마지막 일자: ${s.lastDate || '-'}</span>
          <span>다음 예정일: ${dueDate || '미입력'}</span>
          ${s.note ? `<span>비고: ${escapeHtml(s.note)}</span>` : ''}
        </div>
        <div class="item-card-actions">
          <button type="button" class="btn-icon" data-action="edit-schedule" data-id="${s.id}" aria-label="수정">✏️</button>
          <button type="button" class="btn-icon" data-action="delete-schedule" data-id="${s.id}" aria-label="삭제">🗑️</button>
        </div>
      `;
      frag.appendChild(card);
    });
    scheduleListEl.appendChild(frag);
  }

  // ---------- 소모품 목록 렌더링 ----------

  function renderConsumableList(vehicle) {
    const items = consumables.filter((c) => c.vehicleId === vehicle.id);
    consumableListEl.innerHTML = '';
    if (items.length === 0) {
      consumableEmptyMsgEl.hidden = false;
      return;
    }
    consumableEmptyMsgEl.hidden = true;

    const frag = document.createDocumentFragment();
    items.forEach((c) => {
      const status = getItemStatus(c, vehicle.currentOdometer);
      const dueDate = getNextDueDate(c);
      const kmRemaining = getKmRemaining(c, vehicle.currentOdometer);
      const typeInfo = getConsumableType(c.itemType);
      const label = c.itemType === 'etc' ? (c.customLabel || '기타 소모품') : (typeInfo ? typeInfo.label : c.itemType);
      const cycleParts = [];
      if (c.cycleMonths) cycleParts.push(`${c.cycleMonths}개월`);
      if (c.cycleKm) cycleParts.push(`${Number(c.cycleKm).toLocaleString('ko-KR')}km`);
      const cycleText = cycleParts.length ? cycleParts.join(' / ') : '미입력';

      const dueParts = [];
      if (dueDate) dueParts.push(`날짜: ${dueDate}`);
      if (kmRemaining != null) dueParts.push(`잔여 ${Number(kmRemaining).toLocaleString('ko-KR')}km`);
      const dueText = dueParts.length ? dueParts.join(' · ') : '계산 불가';

      const card = document.createElement('div');
      card.className = 'item-card';
      card.setAttribute('data-consumable-id', c.id);
      card.innerHTML = `
        <div class="item-card-top">
          <span class="item-card-title">${escapeHtml(label)}</span>
          ${statusBadgeHtml(status)}
        </div>
        <div class="item-card-meta">
          <span>마지막 교환: ${c.lastChangeDate || '미입력'}${c.lastChangeOdometer != null ? ` (${formatKm(c.lastChangeOdometer)})` : ''}</span>
          <span>교환주기: ${cycleText}</span>
          <span>다음 교환: ${dueText}</span>
          ${c.note ? `<span>비고: ${escapeHtml(c.note)}</span>` : ''}
        </div>
        <div class="item-card-actions">
          <button type="button" class="btn btn-secondary" data-action="toggle-complete" data-id="${c.id}">교환 완료 처리</button>
          <button type="button" class="btn-icon" data-action="edit-consumable" data-id="${c.id}" aria-label="수정">✏️</button>
          <button type="button" class="btn-icon" data-action="delete-consumable" data-id="${c.id}" aria-label="삭제">🗑️</button>
        </div>
        <div class="inline-form" id="complete-form-${c.id}" hidden>
          <div class="inline-form-row">
            <div class="form-field">
              <label for="complete-date-${c.id}">교환일</label>
              <input type="date" id="complete-date-${c.id}" value="${todayISO()}">
            </div>
            <div class="form-field">
              <label for="complete-odo-${c.id}">현재 주행거리(km)</label>
              <input type="number" id="complete-odo-${c.id}" min="0" step="1" inputmode="numeric" placeholder="선택 입력">
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-primary" data-action="save-complete" data-id="${c.id}">완료 처리 저장</button>
            <button type="button" class="btn btn-secondary" data-action="cancel-complete" data-id="${c.id}">취소</button>
          </div>
        </div>
      `;
      frag.appendChild(card);
    });
    consumableListEl.appendChild(frag);
  }

  // ---------- 차량 등록/수정 폼 ----------

  function updateOdometerHint() {
    const typeInfo = getVehicleType(vehicleTypeSelect.value);
    const isNonRoad = typeInfo && typeInfo.isRoadVehicle === false;
    vehicleOdometerHint.hidden = !isNonRoad;
  }

  function openVehicleForm(vehicleId) {
    const editing = !!vehicleId;
    vehicleFormTitle.textContent = editing ? '차량 정보 수정' : '차량 등록';
    vehicleForm.reset();
    clearFieldErrors(vehicleForm);
    vehicleIdInput.value = vehicleId || '';

    if (editing) {
      const v = vehicles.find((v) => v.id === vehicleId);
      if (!v) return;
      vehiclePlateInput.value = v.plateNumber;
      vehicleTypeSelect.value = v.vehicleType;
      vehicleModelInput.value = v.modelName || '';
      vehicleDriverInput.value = v.driver || '';
      vehicleFirstRegisteredInput.value = v.firstRegisteredDate || '';
      vehicleOdometerInput.value = v.currentOdometer != null ? v.currentOdometer : '';
      vehicleNoteInput.value = v.note || '';
      vehicleAutoConsumablesField.hidden = true;
    } else {
      vehicleTypeSelect.value = VEHICLE_TYPES[0].id;
      vehicleAutoConsumablesField.hidden = false;
      vehicleAutoConsumablesCheckbox.checked = true;
    }

    updateOdometerHint();
    vehicleFormPanel.hidden = false;
    vehicleFormPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeVehicleForm() {
    vehicleFormPanel.hidden = true;
    vehicleFormToast.hidden = true;
  }

  function bindVehicleForm() {
    vehicleTypeSelect.addEventListener('change', updateOdometerHint);

    vehicleFormCancelBtn.addEventListener('click', closeVehicleForm);

    vehicleForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldErrors(vehicleForm);

      const id = vehicleIdInput.value;
      const plate = vehiclePlateInput.value.trim();
      const type = vehicleTypeSelect.value;
      let valid = true;

      if (!plate) {
        showFieldError(vehicleForm, 'plate', '차량번호(식별명)를 입력해주세요.');
        valid = false;
      }
      if (!type) {
        showFieldError(vehicleForm, 'type', '차종을 선택해주세요.');
        valid = false;
      }
      if (!valid) return;

      const odometerRaw = vehicleOdometerInput.value;
      const data = {
        plateNumber: plate,
        vehicleType: type,
        modelName: vehicleModelInput.value.trim(),
        driver: vehicleDriverInput.value.trim(),
        firstRegisteredDate: vehicleFirstRegisteredInput.value || '',
        note: vehicleNoteInput.value.trim(),
        currentOdometer: odometerRaw === '' ? null : Number(odometerRaw),
      };

      if (id) {
        const idx = vehicles.findIndex((v) => v.id === id);
        if (idx !== -1) vehicles[idx] = { ...vehicles[idx], ...data };
        saveVehicles(vehicles);
      } else {
        const newVehicle = { id: generateId('v'), ...data, createdAt: new Date().toISOString() };
        vehicles.push(newVehicle);
        saveVehicles(vehicles);

        if (vehicleAutoConsumablesCheckbox.checked) {
          const typeInfo = getVehicleType(type);
          if (typeInfo) {
            typeInfo.defaultConsumables.forEach((itemType) => {
              const cTypeInfo = getConsumableType(itemType);
              consumables.push({
                id: generateId('c'),
                vehicleId: newVehicle.id,
                itemType,
                customLabel: '',
                lastChangeDate: '',
                lastChangeOdometer: null,
                cycleMonths: cTypeInfo ? cTypeInfo.defaultCycleMonths : null,
                cycleKm: cTypeInfo ? cTypeInfo.defaultCycleKm : null,
                note: '',
              });
            });
            saveConsumables(consumables);
          }
        }
      }

      closeVehicleForm();
      refreshAll();

      vehicleFormToast.textContent = id ? '차량 정보가 수정되었습니다.' : '차량이 등록되었습니다. 예시 정보를 실제 값으로 수정해주세요.';
      vehicleFormToast.hidden = false;
      setTimeout(() => { vehicleFormToast.hidden = true; }, 3500);
    });
  }

  function bindVehicleDelete() {
    detailDeleteBtn.addEventListener('click', () => {
      if (!currentDetailVehicleId) return;
      const v = vehicles.find((v) => v.id === currentDetailVehicleId);
      if (!v) return;
      const ok = confirm(`"${v.plateNumber}" 차량을 삭제하시겠습니까?\n연결된 검사/보험/소모품 항목도 함께 삭제됩니다.`);
      if (!ok) return;

      const result = deleteVehicleCascade(currentDetailVehicleId);
      vehicles = result.vehicles;
      schedules = result.schedules;
      consumables = result.consumables;
      currentDetailVehicleId = null;
      backToDashboard();
    });

    detailEditBtn.addEventListener('click', () => {
      if (!currentDetailVehicleId) return;
      openVehicleForm(currentDetailVehicleId);
    });
  }

  // ---------- 검사/보험 폼 ----------

  function updateScheduleLabelField() {
    if (!currentDetailVehicleId) return;
    const vehicle = vehicles.find((v) => v.id === currentDetailVehicleId);
    if (!vehicle) return;
    const typeInfo = getVehicleType(vehicle.vehicleType);

    if (scheduleCategorySelect.value === 'inspection') {
      scheduleLabelInput.value = typeInfo ? typeInfo.inspectionLabel : '정기검사';
      scheduleLabelInput.readOnly = true;
      scheduleInsurerField.hidden = true;
    } else {
      scheduleLabelInput.readOnly = false;
      if (!scheduleIdInput.value) scheduleLabelInput.value = '';
      scheduleInsurerField.hidden = false;
    }
  }

  function updateScheduleCycleFields() {
    const overridden = scheduleOverrideToggle.checked;
    scheduleCycleMonthsField.hidden = overridden;
    scheduleNextDateField.hidden = !overridden;
  }

  function openScheduleForm(scheduleId) {
    const editing = !!scheduleId;
    scheduleFormTitle.textContent = editing ? '검사/보험 항목 수정' : '검사/보험 항목 추가';
    scheduleForm.reset();
    clearFieldErrors(scheduleForm);
    scheduleIdInput.value = scheduleId || '';

    if (editing) {
      const s = schedules.find((s) => s.id === scheduleId);
      if (!s) return;
      scheduleCategorySelect.value = s.category;
      scheduleLabelInput.value = s.label;
      scheduleLabelInput.readOnly = s.category === 'inspection';
      scheduleInsurerField.hidden = s.category === 'inspection';
      scheduleInsurerInput.value = s.insurer || '';
      scheduleLastDateInput.value = s.lastDate || '';
      scheduleOverrideToggle.checked = !!s.nextDateOverride;
      scheduleCycleMonthsInput.value = s.cycleMonths || '';
      scheduleNextDateInput.value = s.nextDateOverride || '';
      scheduleNoteInput.value = s.note || '';
    } else {
      scheduleCategorySelect.value = 'inspection';
      updateScheduleLabelField();
      scheduleOverrideToggle.checked = false;
    }

    updateScheduleCycleFields();
    scheduleFormPanel.hidden = false;
    scheduleFormPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeScheduleForm() {
    scheduleFormPanel.hidden = true;
    scheduleFormToast.hidden = true;
  }

  function bindScheduleForm() {
    addScheduleBtn.addEventListener('click', () => openScheduleForm(null));
    scheduleFormCancelBtn.addEventListener('click', closeScheduleForm);
    scheduleCategorySelect.addEventListener('change', updateScheduleLabelField);
    scheduleOverrideToggle.addEventListener('change', updateScheduleCycleFields);

    scheduleForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldErrors(scheduleForm);
      if (!currentDetailVehicleId) return;

      const id = scheduleIdInput.value;
      const category = scheduleCategorySelect.value;
      const label = scheduleLabelInput.value.trim();
      const lastDate = scheduleLastDateInput.value;
      const overridden = scheduleOverrideToggle.checked;
      let valid = true;

      if (!label) {
        showFieldError(scheduleForm, 'label', '항목명을 입력해주세요.');
        valid = false;
      }
      if (!lastDate) {
        showFieldError(scheduleForm, 'lastdate', '마지막 일자를 입력해주세요.');
        valid = false;
      }

      let cycleMonths = null;
      let nextDateOverride = null;
      if (overridden) {
        if (!scheduleNextDateInput.value) {
          showFieldError(scheduleForm, 'cycle', '다음 예정일을 입력해주세요.');
          valid = false;
        } else {
          nextDateOverride = scheduleNextDateInput.value;
        }
      } else {
        const months = Number(scheduleCycleMonthsInput.value);
        if (!months || months <= 0) {
          showFieldError(scheduleForm, 'cycle', '주기(개월)를 입력해주세요.');
          valid = false;
        } else {
          cycleMonths = months;
        }
      }

      if (!valid) return;

      // 같은 차량에 같은 label이 이미 있으면 수정 폼으로 유도
      if (!id) {
        const dup = schedules.find((s) => s.vehicleId === currentDetailVehicleId && s.label === label);
        if (dup) {
          const goEdit = confirm('이미 등록된 항목입니다. 수정하시겠습니까?');
          if (goEdit) {
            openScheduleForm(dup.id);
          }
          return;
        }
      }

      const data = {
        vehicleId: currentDetailVehicleId,
        category,
        label,
        insurer: category === 'insurance' ? scheduleInsurerInput.value.trim() : '',
        lastDate,
        cycleMonths,
        nextDateOverride,
        note: scheduleNoteInput.value.trim(),
      };

      if (id) {
        const idx = schedules.findIndex((s) => s.id === id);
        if (idx !== -1) schedules[idx] = { ...schedules[idx], ...data };
      } else {
        schedules.push({ id: generateId('s'), ...data });
      }
      saveSchedules(schedules);

      closeScheduleForm();
      refreshAll();

      scheduleFormToast.textContent = id ? '검사/보험 항목이 수정되었습니다.' : '검사/보험 항목이 등록되었습니다.';
      scheduleFormToast.hidden = false;
      setTimeout(() => { scheduleFormToast.hidden = true; }, 3000);
    });
  }

  function bindScheduleListActions() {
    scheduleListEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');

      if (action === 'edit-schedule') {
        openScheduleForm(id);
      } else if (action === 'delete-schedule') {
        const s = schedules.find((s) => s.id === id);
        if (!s) return;
        const ok = confirm(`"${s.label}" 항목을 삭제하시겠습니까?`);
        if (!ok) return;
        schedules = schedules.filter((s) => s.id !== id);
        saveSchedules(schedules);
        refreshAll();
      }
    });
  }

  // ---------- 소모품 폼 ----------

  function updateConsumableCustomLabelField() {
    consumableCustomLabelField.hidden = consumableItemTypeSelect.value !== 'etc';
  }

  function openConsumableForm(consumableId) {
    const editing = !!consumableId;
    consumableFormTitle.textContent = editing ? '소모품 항목 수정' : '소모품 항목 추가';
    consumableForm.reset();
    clearFieldErrors(consumableForm);
    consumableIdInput.value = consumableId || '';

    if (editing) {
      const c = consumables.find((c) => c.id === consumableId);
      if (!c) return;
      consumableItemTypeSelect.value = c.itemType;
      consumableCustomLabelInput.value = c.customLabel || '';
      consumableLastDateInput.value = c.lastChangeDate || '';
      consumableLastOdometerInput.value = c.lastChangeOdometer != null ? c.lastChangeOdometer : '';
      consumableCycleMonthsInput.value = c.cycleMonths || '';
      consumableCycleKmInput.value = c.cycleKm || '';
      consumableNoteInput.value = c.note || '';
    } else {
      consumableItemTypeSelect.value = CONSUMABLE_TYPES[0].id;
    }

    updateConsumableCustomLabelField();
    consumableFormPanel.hidden = false;
    consumableFormPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeConsumableForm() {
    consumableFormPanel.hidden = true;
    consumableFormToast.hidden = true;
  }

  function bindConsumableForm() {
    addConsumableBtn.addEventListener('click', () => openConsumableForm(null));
    consumableFormCancelBtn.addEventListener('click', closeConsumableForm);
    consumableItemTypeSelect.addEventListener('change', updateConsumableCustomLabelField);

    consumableForm.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldErrors(consumableForm);
      if (!currentDetailVehicleId) return;

      const id = consumableIdInput.value;
      const itemType = consumableItemTypeSelect.value;
      const customLabel = consumableCustomLabelInput.value.trim();
      const lastChangeDate = consumableLastDateInput.value;
      let valid = true;

      if (itemType === 'etc' && !customLabel) {
        showFieldError(consumableForm, 'customlabel', '항목명을 입력해주세요.');
        valid = false;
      }
      if (!lastChangeDate) {
        showFieldError(consumableForm, 'lastdate', '마지막 교환일을 입력해주세요.');
        valid = false;
      }

      const cycleMonthsRaw = consumableCycleMonthsInput.value;
      const cycleKmRaw = consumableCycleKmInput.value;
      const cycleMonths = cycleMonthsRaw === '' ? null : Number(cycleMonthsRaw);
      const cycleKm = cycleKmRaw === '' ? null : Number(cycleKmRaw);
      if (!cycleMonths && !cycleKm) {
        showFieldError(consumableForm, 'cycle', '교환주기는 개월과 km 중 하나 이상 입력해주세요.');
        valid = false;
      }

      if (!valid) return;

      const lastOdoRaw = consumableLastOdometerInput.value;
      const data = {
        vehicleId: currentDetailVehicleId,
        itemType,
        customLabel: itemType === 'etc' ? customLabel : '',
        lastChangeDate,
        lastChangeOdometer: lastOdoRaw === '' ? null : Number(lastOdoRaw),
        cycleMonths,
        cycleKm,
        note: consumableNoteInput.value.trim(),
      };

      if (id) {
        const idx = consumables.findIndex((c) => c.id === id);
        if (idx !== -1) consumables[idx] = { ...consumables[idx], ...data };
      } else {
        consumables.push({ id: generateId('c'), ...data });
      }
      saveConsumables(consumables);

      closeConsumableForm();
      refreshAll();

      consumableFormToast.textContent = id ? '소모품 항목이 수정되었습니다.' : '소모품 항목이 등록되었습니다.';
      consumableFormToast.hidden = false;
      setTimeout(() => { consumableFormToast.hidden = true; }, 3000);
    });
  }

  function bindConsumableListActions() {
    consumableListEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');

      if (action === 'edit-consumable') {
        openConsumableForm(id);
      } else if (action === 'delete-consumable') {
        const c = consumables.find((c) => c.id === id);
        if (!c) return;
        const typeInfo = getConsumableType(c.itemType);
        const label = c.itemType === 'etc' ? (c.customLabel || '기타 소모품') : (typeInfo ? typeInfo.label : c.itemType);
        const ok = confirm(`"${label}" 항목을 삭제하시겠습니까?`);
        if (!ok) return;
        consumables = consumables.filter((c) => c.id !== id);
        saveConsumables(consumables);
        refreshAll();
      } else if (action === 'toggle-complete') {
        const formEl = document.getElementById(`complete-form-${id}`);
        if (formEl) formEl.hidden = !formEl.hidden;
      } else if (action === 'cancel-complete') {
        const formEl = document.getElementById(`complete-form-${id}`);
        if (formEl) formEl.hidden = true;
      } else if (action === 'save-complete') {
        const dateInput = document.getElementById(`complete-date-${id}`);
        const odoInput = document.getElementById(`complete-odo-${id}`);
        const dateVal = dateInput ? dateInput.value : '';
        if (!dateVal) {
          alert('교환일을 입력해주세요.');
          return;
        }
        const idx = consumables.findIndex((c) => c.id === id);
        if (idx === -1) return;
        consumables[idx] = {
          ...consumables[idx],
          lastChangeDate: dateVal,
          lastChangeOdometer: odoInput && odoInput.value !== '' ? Number(odoInput.value) : consumables[idx].lastChangeOdometer,
        };
        saveConsumables(consumables);
        refreshAll();
      }
    });
  }

  // ---------- 내보내기 / 가져오기 ----------

  function bindExportImport() {
    exportBtn.addEventListener('click', () => {
      const payload = {
        vehicles,
        schedules,
        consumables,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-fleet-backup-${todayISO().replace(/-/g, '')}.json`;
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
          if (!parsed || typeof parsed !== 'object') throw new Error('형식이 잘못되었습니다.');
          if (!Array.isArray(parsed.vehicles) || !Array.isArray(parsed.schedules) || !Array.isArray(parsed.consumables)) {
            throw new Error('vehicles/schedules/consumables 배열이 필요합니다.');
          }
        } catch (err) {
          alert('가져오기 실패: 올바른 법인차량 관리 백업(JSON) 파일이 아닙니다.');
          importFile.value = '';
          return;
        }

        const merge = confirm(
          `차량 ${parsed.vehicles.length}대의 데이터를 가져왔습니다.\n\n[확인] = 기존 데이터와 병합(같은 id는 덮어쓰기)\n[취소] = 기존 데이터를 이 파일로 전체 교체`
        );

        if (merge) {
          const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));
          parsed.vehicles.forEach((v) => vehicleMap.set(v.id, v));
          vehicles = Array.from(vehicleMap.values());

          const scheduleMap = new Map(schedules.map((s) => [s.id, s]));
          parsed.schedules.forEach((s) => scheduleMap.set(s.id, s));
          schedules = Array.from(scheduleMap.values());

          const consumableMap = new Map(consumables.map((c) => [c.id, c]));
          parsed.consumables.forEach((c) => consumableMap.set(c.id, c));
          consumables = Array.from(consumableMap.values());
        } else {
          vehicles = parsed.vehicles;
          schedules = parsed.schedules;
          consumables = parsed.consumables;
        }

        saveVehicles(vehicles);
        saveSchedules(schedules);
        saveConsumables(consumables);

        currentDetailVehicleId = null;
        showScreen('dashboard');
        refreshAll();
        importFile.value = '';
        alert('가져오기가 완료되었습니다.');
      };
      reader.readAsText(file);
    });
  }

  // ---------- 다크모드 ----------

  const THEME_KEY = 'vehicle-fleet-theme';

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

  // ---------- 사용법 안내 박스 ----------

  const GUIDE_KEY = 'vehicle-fleet-guide-collapsed';

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

  // ---------- 알림 설정 모달 ----------

  function updateNotifyOffDot() {
    const config = loadNotifyConfig();
    const on = config.enabled && !!config.webhookUrl;
    notifyOffDot.classList.toggle('on', on);
  }

  function openNotifyModal() {
    const config = loadNotifyConfig();
    notifyWebhookUrlInput.value = config.webhookUrl || '';
    notifyEnabledCheckbox.checked = !!config.enabled;
    notifyUrlWarning.hidden = true;
    notifyTestResult.hidden = true;
    notifyFailNote.hidden = true;
    lastFocusedEl = document.activeElement;
    notifyModalOverlay.hidden = false;
    notifyModalClose.focus();
  }

  function closeNotifyModal() {
    notifyModalOverlay.hidden = true;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  }

  function bindNotifyModal() {
    notifySettingsBtn.addEventListener('click', openNotifyModal);
    notifyModalClose.addEventListener('click', closeNotifyModal);
    notifyModalOverlay.addEventListener('click', (event) => {
      if (event.target === notifyModalOverlay) closeNotifyModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !notifyModalOverlay.hidden) closeNotifyModal();
    });

    notifyTestBtn.addEventListener('click', () => {
      const url = notifyWebhookUrlInput.value.trim();
      if (!url) {
        notifyTestResult.hidden = false;
        notifyTestResult.textContent = '먼저 웹훅 URL을 입력해주세요.';
        return;
      }
      const dummyPayload = { text: '[법인차량 관리] 테스트 메시지입니다.', overdueCount: 0, dueSoonCount: 0, items: [] };
      sendWebhookNotification(url, dummyPayload).then((ok) => {
        notifyTestResult.hidden = false;
        notifyTestResult.textContent = ok
          ? '전송을 시도했습니다. 브라우저 네트워크 탭 또는 수신 측에서 도착 여부를 확인하세요.'
          : '전송 요청 자체가 실패했습니다. URL을 다시 확인해주세요.';
      });
    });

    notifySaveBtn.addEventListener('click', () => {
      const url = notifyWebhookUrlInput.value.trim();
      let enabled = notifyEnabledCheckbox.checked;

      if (enabled && !url) {
        notifyUrlWarning.hidden = false;
        enabled = false;
        notifyEnabledCheckbox.checked = false;
      } else {
        notifyUrlWarning.hidden = true;
      }

      saveNotifyConfig({ webhookUrl: url, enabled });
      updateNotifyOffDot();
      closeNotifyModal();
    });
  }

  // 앱 로드 시(대시보드 렌더링 직후) 임박/경과 항목을 웹훅으로 전송
  function runAutoNotifyCheck() {
    const config = loadNotifyConfig();
    if (!config.enabled || !config.webhookUrl) return;

    const notifyLog = loadNotifyLog();
    const today = new Date();
    const targets = getNotifyTargets(vehicles, schedules, consumables, notifyLog, today);
    if (targets.length === 0) return;

    const payload = buildNotifyPayload(targets);
    sendWebhookNotification(config.webhookUrl, payload).then((ok) => {
      if (!ok) console.warn('[vehicle-fleet] 자동 알림 전송 실패');
    });

    const todayStr = today.toISOString().slice(0, 10);
    targets.forEach((t) => { notifyLog[t.key] = todayStr; });
    saveNotifyLog(notifyLog);
  }

  // ---------- 초기화 ----------

  function init() {
    populateVehicleTypeSelect();
    populateConsumableTypeSelect();
    populateInsurancePresets();

    addVehicleBtn.addEventListener('click', () => openVehicleForm(null));
    backToDashboardBtn.addEventListener('click', backToDashboard);

    bindVehicleForm();
    bindVehicleDelete();
    bindScheduleForm();
    bindScheduleListActions();
    bindConsumableForm();
    bindConsumableListActions();
    bindExportImport();
    bindNotifyModal();

    initTheme();
    initGuideBox();

    showScreen('dashboard');
    renderDashboard();
    updateNotifyOffDot();
    runAutoNotifyCheck();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
