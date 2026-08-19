(function () {
  'use strict';

  var STATE_KEY = 'settlement-app-state';

  var state = null;

  // ---------------------------------------------------------------------
  // 공통 유틸 (shared-utils.js) — round/calcVat/calcTotal/parseNumber/
  // formatNumber/formatBizRegNo/escapeAttr/sanitizeFilenamePart 함수 정의는
  // shared-utils.js로 옮겼다. 계산 규칙이 두 화면(정산서 화면/계산서함)에서
  // 어긋나면 자동 생성된 정산서 금액이 화면마다 다르게 보이는 치명적 버그로
  // 이어지므로, 여기서는 SettlementShared를 그대로 참조만 한다.
  // ---------------------------------------------------------------------
  var SettlementShared = window.SettlementShared;
  var round = SettlementShared.round;
  var calcVat = SettlementShared.calcVat;
  var calcTotal = SettlementShared.calcTotal;
  var parseNumber = SettlementShared.parseNumber;
  var formatNumber = SettlementShared.formatNumber;
  var formatBizRegNo = SettlementShared.formatBizRegNo;
  var escapeAttr = SettlementShared.escapeAttr;
  var sanitizeFilenamePart = SettlementShared.sanitizeFilenamePart;

  // ---------------------------------------------------------------------
  // 상태(state) 초기값 — 팩토리 함수는 shared-utils.js로 이관됨. 계산서함
  // (invoices.js)의 "공사명으로 정산서 생성"이 정확히 같은 모양의 빈
  // 정산서를 만들어야 하므로 여기서도 SettlementShared를 그대로 참조한다.
  // ---------------------------------------------------------------------
  var makeSubcontractRow = SettlementShared.makeSubcontractRow;
  var makeLaborRow = SettlementShared.makeLaborRow;
  var makeEtcRow = SettlementShared.makeEtcRow;
  var createEmptyState = SettlementShared.createEmptyState;
  var normalizeState = SettlementShared.normalizeState;

  // ---------------------------------------------------------------------
  // localStorage 저장/복원
  // ---------------------------------------------------------------------
  function saveToLocalStorage() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable - 무시 */
    }
    // 공사명이 있으면 "저장된 정산서 저장소"에도 함께 미러 저장한다. 이렇게
    // 하면 사용자가 index.html에서 손으로 채우는 기존 워크플로우도 자동으로
    // "이름 붙은 정산서 저장소"에 쌓이고, 계산서함에서 자동 생성한 정산서도
    // 같은 저장소를 공유하게 된다.
    // (spec-v2-invoice.md 3.1은 이 미러 저장을 onStateChange()에 붙이도록
    // 명시했지만, 실제로는 공사명 입력 등 여러 경로가 onStateChange()를
    // 거치지 않고 saveToLocalStorage()만 직접 호출한다 — 예: bindSimpleInputs()의
    // 공사명 input 핸들러. saveToLocalStorage()가 유일한 저장 지점이므로
    // 여기에 붙여야 모든 저장 경로에서 누락 없이 미러링된다.)
    if (state.projectInfo.name) {
      SettlementShared.saveProjectByName(state.projectInfo.name, state);
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) {
      /* 손상된 데이터는 무시하고 빈 템플릿 사용 */
    }
    return createEmptyState();
  }

  // ---------------------------------------------------------------------
  // 다크모드 — shared-utils.js로 이관됨(테마 키도 그대로 공유).
  // shared-utils.js가 이 파일보다 먼저 로드되며 파싱 시점에 이미 테마를
  // 적용해두므로(깜빡임 방지) 여기서는 함수만 참조한다.
  // ---------------------------------------------------------------------
  var getPreferredTheme = SettlementShared.getPreferredTheme;
  var updateThemeToggleIcon = SettlementShared.updateThemeToggleIcon;
  var applyTheme = SettlementShared.applyTheme;
  var toggleTheme = SettlementShared.toggleTheme;

  // ---------------------------------------------------------------------
  // 소계 계산
  // ---------------------------------------------------------------------
  function subcontractSubtotal() {
    var supply = 0, vat = 0, total = 0;
    state.subcontract.forEach(function (row) {
      var v = calcVat(row.supplyAmount);
      supply += Number(row.supplyAmount) || 0;
      vat += v;
      total += calcTotal(row.supplyAmount, v);
    });
    return { supplyAmount: supply, vat: vat, total: total };
  }

  function laborSubtotal() {
    var supply = 0, withholding = 0, total = 0;
    state.labor.forEach(function (row) {
      var s = Number(row.supplyAmount) || 0;
      var w = Number(row.withholdingTax) || 0;
      supply += s;
      withholding += w;
      total += (s - w);
    });
    return { supplyAmount: supply, withholdingTax: withholding, total: total };
  }

  function etcSubtotal() {
    var supply = 0, vat = 0, total = 0;
    state.etc.forEach(function (row) {
      var s = Number(row.supplyAmount) || 0;
      var v = Number(row.vat) || 0;
      supply += s;
      vat += v;
      total += (s + v);
    });
    return { supplyAmount: supply, vat: vat, total: total };
  }

  // ---------------------------------------------------------------------
  // 포커스 유지 헬퍼 (표 재렌더링 시 입력 중이던 셀의 포커스/커서 위치 유지)
  // ---------------------------------------------------------------------
  function captureFocus(containerEl) {
    var active = document.activeElement;
    if (!active || !containerEl.contains(active)) return null;
    var tr = active.closest('tr[data-id]');
    if (!tr) return null;
    return {
      id: tr.getAttribute('data-id'),
      field: active.getAttribute('data-field'),
      selStart: (typeof active.selectionStart === 'number') ? active.selectionStart : null,
      selEnd: (typeof active.selectionEnd === 'number') ? active.selectionEnd : null
    };
  }

  function restoreFocus(containerEl, info) {
    if (!info || !info.field) return;
    var selector = 'tr[data-id="' + info.id + '"] [data-field="' + info.field + '"]';
    var el = containerEl.querySelector(selector);
    if (!el) return;
    el.focus();
    if (info.selStart !== null && el.setSelectionRange) {
      try { el.setSelectionRange(info.selStart, info.selEnd); } catch (e) { /* 무시 */ }
    }
  }

  // ---------------------------------------------------------------------
  // 렌더링
  // ---------------------------------------------------------------------
  function renderProjectInfo() {
    var nameInput = document.getElementById('project-name');
    if (document.activeElement !== nameInput) nameInput.value = state.projectInfo.name;

    var supplyInput = document.getElementById('project-supply');
    if (document.activeElement !== supplyInput) supplyInput.value = formatNumber(state.projectInfo.supplyAmount);

    var vat = calcVat(state.projectInfo.supplyAmount);
    var total = calcTotal(state.projectInfo.supplyAmount, vat);
    document.getElementById('project-vat').textContent = formatNumber(vat);
    document.getElementById('project-total').textContent = formatNumber(total);

    populateProjectPicker();
  }

  // ---------------------------------------------------------------------
  // "저장된 정산서 불러오기" 드롭다운
  //
  // settlement-app-saved-projects 저장소(공사명 → 정산서 state)에 있는
  // 공사명 목록을 보여준다. 계산서함(invoices.html)에서 "공사명으로 정산서
  // 생성"을 눌러 만든 정산서도, index.html에서 손으로 채워 자동 미러 저장된
  // 정산서도 같은 저장소를 공유하므로 여기서 함께 보인다.
  // ---------------------------------------------------------------------
  function populateProjectPicker() {
    var select = document.getElementById('project-picker');
    if (!select) return;
    var names = SettlementShared.getSavedProjectNames().sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    });
    var html = '<option value="">불러올 정산서 선택…</option>';
    names.forEach(function (name) {
      html += '<option value="' + escapeAttr(name) + '">' + escapeAttr(name) + '</option>';
    });
    if (document.activeElement !== select) select.innerHTML = html;
  }

  function bindProjectPicker() {
    var select = document.getElementById('project-picker');
    if (!select) return;
    select.addEventListener('change', function () {
      var chosen = select.value;
      select.value = '';
      if (!chosen) return;

      // 고른 공사명이 지금 화면과 다를 때만 "벗어나도 되는지" 확인한다. 같은
      // 공사명을 다시 고른 경우에도 그냥 무시하지 않고 저장소에서 다시
      // 불러온다 — 계산서함(invoices.html)에서 같은 공사명으로 "정산서 생성"
      // (병합)을 실행하면 저장소(settlement-app-saved-projects)의 내용만
      // 갱신되고 지금 화면의 활성 상태(state)는 그대로이므로, 같은 이름을
      // 다시 선택해도 아무 일도 일어나지 않으면 방금 계산서함에서 반영한
      // 내용을 이 화면에서 확인할 방법이 없어진다.
      if (chosen !== state.projectInfo.name && state.projectInfo.name) {
        var ok = confirm(
          '현재 화면(' + state.projectInfo.name + ')에서 벗어나 "' + chosen + '" 정산서를 불러옵니다.\n' +
          '현재 내용은 이미 이 브라우저에 자동 저장되어 있으니, 나중에 이 드롭다운에서 다시 선택해 불러올 수 있습니다.\n\n계속할까요?'
        );
        if (!ok) return;
      }

      var saved = SettlementShared.loadSavedProjects();
      var projectState = saved[chosen];
      if (!projectState) {
        alert('저장된 정산서를 찾을 수 없습니다.');
        return;
      }
      state = normalizeState(projectState);
      renderAll();
      saveToLocalStorage();
    });
  }

  function renderAccount() {
    var bankInput = document.getElementById('account-bank');
    if (document.activeElement !== bankInput) bankInput.value = state.account.bankName;
    var numInput = document.getElementById('account-number');
    if (document.activeElement !== numInput) numInput.value = state.account.accountNumber;
  }

  function renderSubcontract() {
    var tbody = document.getElementById('subcontract-body');
    var focusInfo = captureFocus(tbody);
    var rowsHtml = '';
    var sumSupply = 0, sumVat = 0, sumTotal = 0;

    state.subcontract.forEach(function (row, idx) {
      var vat = calcVat(row.supplyAmount);
      var total = calcTotal(row.supplyAmount, vat);
      var balance = total - (Number(row.paidAmount) || 0);
      sumSupply += Number(row.supplyAmount) || 0;
      sumVat += vat;
      sumTotal += total;

      rowsHtml +=
        '<tr data-id="' + row.id + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><input type="text" data-field="workType" value="' + escapeAttr(row.workType) + '"></td>' +
        '<td><input type="date" data-field="issueDate" value="' + escapeAttr(row.issueDate) + '"></td>' +
        '<td><input type="text" data-field="vendor" value="' + escapeAttr(row.vendor) + '"></td>' +
        '<td><input type="text" inputmode="numeric" maxlength="12" placeholder="000-00-00000" data-field="bizRegNo" value="' + escapeAttr(row.bizRegNo) + '"></td>' +
        '<td><input type="text" inputmode="numeric" data-money="true" data-field="supplyAmount" value="' + formatNumber(row.supplyAmount) + '"></td>' +
        '<td class="derived-cell" data-derived="vat">' + formatNumber(vat) + '</td>' +
        '<td class="derived-cell" data-derived="total">' + formatNumber(total) + '</td>' +
        '<td style="text-align:center"><input type="checkbox" data-field="taxInvoiceIssued"' + (row.taxInvoiceIssued ? ' checked' : '') + '></td>' +
        '<td><input type="text" data-field="bank" value="' + escapeAttr(row.bank) + '"></td>' +
        '<td><input type="date" data-field="payDate" value="' + escapeAttr(row.payDate) + '"></td>' +
        '<td><input type="text" inputmode="numeric" data-money="true" data-field="paidAmount" value="' + formatNumber(row.paidAmount) + '"></td>' +
        '<td class="derived-cell" data-derived="balance">' + formatNumber(balance) + '</td>' +
        '<td><input type="text" data-field="accountInfo" value="' + escapeAttr(row.accountInfo) + '"></td>' +
        '<td><input type="text" data-field="contact" value="' + escapeAttr(row.contact) + '"></td>' +
        '<td><input type="text" data-field="note" value="' + escapeAttr(row.note) + '"></td>' +
        '<td><button type="button" class="btn-remove-row" data-remove-row="subcontract" aria-label="행 삭제">×</button></td>' +
        '</tr>';
    });

    tbody.innerHTML = rowsHtml;
    document.getElementById('subcontract-sum-supply').textContent = formatNumber(sumSupply);
    document.getElementById('subcontract-sum-vat').textContent = formatNumber(sumVat);
    document.getElementById('subcontract-sum-total').textContent = formatNumber(sumTotal);
    restoreFocus(tbody, focusInfo);
  }

  function renderLabor() {
    var tbody = document.getElementById('labor-body');
    var focusInfo = captureFocus(tbody);
    var rowsHtml = '';
    var sumSupply = 0, sumWithholding = 0, sumTotal = 0;

    state.labor.forEach(function (row, idx) {
      var s = Number(row.supplyAmount) || 0;
      var w = Number(row.withholdingTax) || 0;
      var total = s - w;
      sumSupply += s;
      sumWithholding += w;
      sumTotal += total;

      rowsHtml +=
        '<tr data-id="' + row.id + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><input type="date" data-field="issueDate" value="' + escapeAttr(row.issueDate) + '"></td>' +
        '<td><input type="text" data-field="workerName" value="' + escapeAttr(row.workerName) + '"></td>' +
        '<td><input type="text" data-field="item" value="' + escapeAttr(row.item) + '"></td>' +
        '<td><input type="text" inputmode="numeric" data-money="true" data-field="supplyAmount" value="' + formatNumber(row.supplyAmount) + '"></td>' +
        '<td><input type="text" inputmode="numeric" data-money="true" data-field="withholdingTax" value="' + formatNumber(row.withholdingTax) + '"></td>' +
        '<td class="derived-cell" data-derived="total">' + formatNumber(total) + '</td>' +
        '<td><button type="button" class="btn-remove-row" data-remove-row="labor" aria-label="행 삭제">×</button></td>' +
        '</tr>';
    });

    tbody.innerHTML = rowsHtml;
    document.getElementById('labor-sum-supply').textContent = formatNumber(sumSupply);
    document.getElementById('labor-sum-withholding').textContent = formatNumber(sumWithholding);
    document.getElementById('labor-sum-total').textContent = formatNumber(sumTotal);
    restoreFocus(tbody, focusInfo);
  }

  function renderEtc() {
    var tbody = document.getElementById('etc-body');
    var focusInfo = captureFocus(tbody);
    var rowsHtml = '';
    var sumSupply = 0, sumVat = 0, sumTotal = 0;

    state.etc.forEach(function (row, idx) {
      var s = Number(row.supplyAmount) || 0;
      var v = Number(row.vat) || 0;
      var total = s + v;
      sumSupply += s;
      sumVat += v;
      sumTotal += total;

      rowsHtml +=
        '<tr data-id="' + row.id + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><input type="date" data-field="issueDate" value="' + escapeAttr(row.issueDate) + '"></td>' +
        '<td><input type="text" data-field="vendor" value="' + escapeAttr(row.vendor) + '"></td>' +
        '<td><input type="text" data-field="item" value="' + escapeAttr(row.item) + '"></td>' +
        '<td><input type="text" inputmode="numeric" data-money="true" data-field="supplyAmount" value="' + formatNumber(row.supplyAmount) + '"></td>' +
        '<td><div class="vat-cell-wrap"><input type="text" inputmode="numeric" data-money="true" data-field="vat" value="' + formatNumber(row.vat) + '"><button type="button" class="btn-fill-vat" data-fill-vat="etc" aria-label="공급가액의 10%로 부가세 채우기">×10%</button></div></td>' +
        '<td class="derived-cell" data-derived="total">' + formatNumber(total) + '</td>' +
        '<td><button type="button" class="btn-remove-row" data-remove-row="etc" aria-label="행 삭제">×</button></td>' +
        '</tr>';
    });

    tbody.innerHTML = rowsHtml;
    document.getElementById('etc-sum-supply').textContent = formatNumber(sumSupply);
    document.getElementById('etc-sum-vat').textContent = formatNumber(sumVat);
    document.getElementById('etc-sum-total').textContent = formatNumber(sumTotal);
    restoreFocus(tbody, focusInfo);
  }

  function summaryARowHtml(label, obj, highlight) {
    return '<tr' + (highlight ? ' class="summary-highlight"' : '') + '>' +
      '<td>' + escapeAttr(label) + '</td>' +
      '<td>' + formatNumber(obj.supplyAmount) + '</td>' +
      '<td>' + formatNumber(obj.vat) + '</td>' +
      '<td>' + formatNumber(obj.total) + '</td>' +
      '</tr>';
  }

  function summaryBRowHtml(label, value, note, highlight) {
    return '<tr' + (highlight ? ' class="summary-highlight"' : '') + '>' +
      '<td>' + escapeAttr(label) + (note ? '<span class="summary-note">' + escapeAttr(note) + '</span>' : '') + '</td>' +
      '<td>' + formatNumber(value) + '</td>' +
      '</tr>';
  }

  function renderSummary() {
    var projSupply = Number(state.projectInfo.supplyAmount) || 0;
    var projVat = calcVat(projSupply);
    var projTotal = calcTotal(projSupply, projVat);

    var sub = subcontractSubtotal();
    var lab = laborSubtotal();
    var etc = etcSubtotal();

    // 요약 A: 세금계산서 대비 지출 비교
    var taxInvoiceRow = { supplyAmount: projSupply, vat: projVat, total: projTotal };
    var purchaseRow = { supplyAmount: sub.supplyAmount, vat: sub.vat, total: sub.total };
    var laborRowA = { supplyAmount: lab.supplyAmount, vat: 0, total: lab.total };
    var etcRow = { supplyAmount: etc.supplyAmount, vat: etc.vat, total: etc.total };
    var remainMargin = {
      supplyAmount: taxInvoiceRow.supplyAmount - purchaseRow.supplyAmount - laborRowA.supplyAmount - etcRow.supplyAmount,
      vat: taxInvoiceRow.vat - purchaseRow.vat - laborRowA.vat - etcRow.vat,
      total: taxInvoiceRow.total - purchaseRow.total - laborRowA.total - etcRow.total
    };

    document.getElementById('summary-a-body').innerHTML =
      summaryARowHtml('세금계산서발행금액', taxInvoiceRow) +
      summaryARowHtml('매입자료금액', purchaseRow) +
      summaryARowHtml('노무비', laborRowA) +
      summaryARowHtml('기타보증서', etcRow) +
      summaryARowHtml('잔여마진', remainMargin, true);

    // 요약 B: 수익 정산표
    var techFee = round(projSupply * 0.05);
    var expense = etc.supplyAmount;
    var purchaseAmount = sub.supplyAmount;
    var laborTotal = lab.total;
    var remainAmount = projSupply - techFee - expense - purchaseAmount - laborTotal;

    document.getElementById('summary-b-body').innerHTML =
      summaryBRowHtml('공급가액', projSupply) +
      summaryBRowHtml('기술료', techFee, '공급가액 × 5%') +
      summaryBRowHtml('경비', expense, '건설공제조합/전력 및 수도광열비 등') +
      summaryBRowHtml('매입액', purchaseAmount) +
      summaryBRowHtml('노무비', laborTotal) +
      summaryBRowHtml('잔여금액', remainAmount, null, true);
  }

  function renderAll() {
    renderProjectInfo();
    renderSubcontract();
    renderLabor();
    renderEtc();
    renderSummary();
    renderAccount();
  }

  function onStateChange() {
    renderAll();
    saveToLocalStorage();
  }

  // ---------------------------------------------------------------------
  // 행 단위 부분 갱신 (표 전체를 다시 그리지 않고 계산 결과 칸만 갱신)
  //
  // 타이핑할 때마다 tbody.innerHTML을 통째로 다시 그리면, 지금 입력 중인
  // <input> DOM이 새 것으로 교체되어 한글 등 조합(IME) 입력이 끊긴다.
  // 그래서 텍스트를 입력하는 동안에는 그 입력칸 자체는 절대 건드리지 않고,
  // 부가세/합계/잔액 같은 "읽기 전용 계산 결과" 칸과 소계 행만 값을 바꿔준다.
  // ---------------------------------------------------------------------
  function refreshSubcontractRow(tr, row) {
    var vat = calcVat(row.supplyAmount);
    var total = calcTotal(row.supplyAmount, vat);

    var vatCell = tr.querySelector('[data-derived="vat"]');
    var totalCell = tr.querySelector('[data-derived="total"]');
    var balanceCell = tr.querySelector('[data-derived="balance"]');

    if (vatCell) vatCell.textContent = formatNumber(vat);
    if (totalCell) totalCell.textContent = formatNumber(total);

    var balance = total - (Number(row.paidAmount) || 0);
    if (balanceCell) balanceCell.textContent = formatNumber(balance);
  }

  function refreshSubcontractFooter() {
    var sum = subcontractSubtotal();
    document.getElementById('subcontract-sum-supply').textContent = formatNumber(sum.supplyAmount);
    document.getElementById('subcontract-sum-vat').textContent = formatNumber(sum.vat);
    document.getElementById('subcontract-sum-total').textContent = formatNumber(sum.total);
  }

  function refreshLaborRow(tr, row) {
    var s = Number(row.supplyAmount) || 0;
    var w = Number(row.withholdingTax) || 0;
    var totalCell = tr.querySelector('[data-derived="total"]');
    if (totalCell) totalCell.textContent = formatNumber(s - w);
  }

  function refreshLaborFooter() {
    var sum = laborSubtotal();
    document.getElementById('labor-sum-supply').textContent = formatNumber(sum.supplyAmount);
    document.getElementById('labor-sum-withholding').textContent = formatNumber(sum.withholdingTax);
    document.getElementById('labor-sum-total').textContent = formatNumber(sum.total);
  }

  function refreshEtcRow(tr, row) {
    var s = Number(row.supplyAmount) || 0;
    var v = Number(row.vat) || 0;
    var totalCell = tr.querySelector('[data-derived="total"]');
    if (totalCell) totalCell.textContent = formatNumber(s + v);
  }

  function refreshEtcFooter() {
    var sum = etcSubtotal();
    document.getElementById('etc-sum-supply').textContent = formatNumber(sum.supplyAmount);
    document.getElementById('etc-sum-vat').textContent = formatNumber(sum.vat);
    document.getElementById('etc-sum-total').textContent = formatNumber(sum.total);
  }

  // ---------------------------------------------------------------------
  // 행 조작
  // ---------------------------------------------------------------------
  function findRow(tableName, id) {
    var arr = state[tableName];
    id = String(id);
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].id) === id) return arr[i];
    }
    return null;
  }

  function addRow(tableName) {
    var row;
    if (tableName === 'subcontract') {
      row = makeSubcontractRow(state.subcontractNextId++);
    } else if (tableName === 'labor') {
      row = makeLaborRow(state.laborNextId++);
    } else if (tableName === 'etc') {
      row = makeEtcRow(state.etcNextId++);
    } else {
      return;
    }
    state[tableName].push(row);
    onStateChange();

    var bodyId = tableName === 'subcontract' ? 'subcontract-body' : (tableName === 'labor' ? 'labor-body' : 'etc-body');
    var tbody = document.getElementById(bodyId);
    var last = tbody.querySelector('tr:last-child');
    if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
  }

  function removeRow(tableName, id) {
    id = String(id);
    state[tableName] = state[tableName].filter(function (r) { return String(r.id) !== id; });
    onStateChange();
  }

  function fillVatFromSupply(tableName, id) {
    var row = findRow(tableName, id);
    if (!row) return;
    row.vat = calcVat(row.supplyAmount);

    var bodyId = tableName === 'subcontract' ? 'subcontract-body' : (tableName === 'labor' ? 'labor-body' : 'etc-body');
    var tbody = document.getElementById(bodyId);
    var tr = tbody.querySelector('tr[data-id="' + id + '"]');
    if (tr) {
      var vatInput = tr.querySelector('[data-field="vat"]');
      if (vatInput && document.activeElement !== vatInput) vatInput.value = formatNumber(row.vat);
      if (tableName === 'etc') {
        refreshEtcRow(tr, row);
        refreshEtcFooter();
      }
    }
    renderSummary();
    saveToLocalStorage();
  }

  function updateRowField(tableName, row, field, target) {
    if (target.dataset.money === 'true') {
      row[field] = parseNumber(target.value);
    } else if (target.type === 'checkbox') {
      row[field] = target.checked;
    } else if (tableName === 'subcontract' && field === 'bizRegNo') {
      var caret = target.selectionStart;
      var beforeLen = target.value.length;
      var formatted = formatBizRegNo(target.value);
      row.bizRegNo = formatted;
      target.value = formatted;
      var newCaret = caret + (formatted.length - beforeLen);
      if (newCaret < 0) newCaret = 0;
      if (newCaret > formatted.length) newCaret = formatted.length;
      try { target.setSelectionRange(newCaret, newCaret); } catch (e) { /* 일부 브라우저 미지원 - 무시 */ }
    } else {
      row[field] = target.value;
    }
  }

  function bindTableEvents(tbodyId, tableName) {
    var tbody = document.getElementById(tbodyId);

    tbody.addEventListener('input', function (e) {
      var target = e.target;
      var field = target.dataset.field;
      if (!field || target.type === 'checkbox') return;
      var tr = target.closest('tr[data-id]');
      if (!tr) return;
      var row = findRow(tableName, tr.getAttribute('data-id'));
      if (!row) return;
      updateRowField(tableName, row, field, target);

      // 표를 통째로 다시 그리지 않고 계산 결과 칸/소계/요약만 갱신한다.
      // 지금 입력 중인 <input>은 절대 교체하지 않으므로 한글 조합(IME)이 끊기지 않는다.
      if (tableName === 'subcontract') {
        refreshSubcontractRow(tr, row);
        refreshSubcontractFooter();
      } else if (tableName === 'labor') {
        refreshLaborRow(tr, row);
        refreshLaborFooter();
      } else if (tableName === 'etc') {
        refreshEtcRow(tr, row);
        refreshEtcFooter();
      }
      renderSummary();
      saveToLocalStorage();
    });

    tbody.addEventListener('change', function (e) {
      var target = e.target;
      if (target.type !== 'checkbox') return;
      var field = target.dataset.field;
      var tr = target.closest('tr[data-id]');
      if (!tr || !field) return;
      var row = findRow(tableName, tr.getAttribute('data-id'));
      if (!row) return;
      row[field] = target.checked;
      saveToLocalStorage();
    });

    tbody.addEventListener('click', function (e) {
      var removeBtn = e.target.closest('[data-remove-row]');
      if (removeBtn) {
        var tr = removeBtn.closest('tr[data-id]');
        if (tr) removeRow(tableName, tr.getAttribute('data-id'));
        return;
      }
      var fillBtn = e.target.closest('[data-fill-vat]');
      if (fillBtn) {
        var tr2 = fillBtn.closest('tr[data-id]');
        if (tr2) fillVatFromSupply(fillBtn.getAttribute('data-fill-vat'), tr2.getAttribute('data-id'));
      }
    });
  }

  // ---------------------------------------------------------------------
  // 상단 정보 / 계좌 정보 입력 바인딩
  // ---------------------------------------------------------------------
  function bindSimpleInputs() {
    // 공사명/계좌 정보는 어떤 계산에도 쓰이지 않으므로 값만 저장하고
    // 화면을 다시 그리지 않는다(입력 중인 칸을 건드리지 않아야 한글 조합이 안 끊긴다).
    var nameInput = document.getElementById('project-name');
    nameInput.addEventListener('input', function () {
      state.projectInfo.name = nameInput.value;
      saveToLocalStorage();
    });

    var supplyInput = document.getElementById('project-supply');
    supplyInput.addEventListener('input', function () {
      state.projectInfo.supplyAmount = parseNumber(supplyInput.value);
      renderProjectInfo();
      renderSummary();
      saveToLocalStorage();
    });

    var bankInput = document.getElementById('account-bank');
    bankInput.addEventListener('input', function () {
      state.account.bankName = bankInput.value;
      saveToLocalStorage();
    });

    var accNumInput = document.getElementById('account-number');
    accNumInput.addEventListener('input', function () {
      state.account.accountNumber = accNumInput.value;
      saveToLocalStorage();
    });
  }

  // 날짜 입력(발행일 등): 필드 아무 곳이나 클릭해도 달력이 바로 열리도록 한다.
  // 기본 상태에서는 작은 달력 아이콘을 정확히 눌러야만 달력이 뜨고, 그렇지 않으면
  // 연/월/일 각 칸을 스핀 버튼으로 따로 조작해야 해서 "월을 고르면서 일도 같이
  // 고르기"가 불편하다. showPicker()를 지원하는 브라우저에서는 클릭 시 항상
  // 달력 전체(월 이동 + 날짜 그리드)가 뜨도록 해 한 번에 월과 일을 고를 수 있게 한다.
  function bindDatePickers() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (el && el.tagName === 'INPUT' && el.type === 'date' && typeof el.showPicker === 'function') {
        try { el.showPicker(); } catch (err) { /* 미지원 브라우저이거나 이미 열려있음 - 무시 */ }
      }
    });
  }

  // 금액 입력(data-money="true") 공통 focus/blur 콤마 포맷 처리 (문서 위임)
  function bindMoneyFormatting() {
    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el && el.tagName === 'INPUT' && el.dataset && el.dataset.money === 'true') {
        var n = parseNumber(el.value);
        el.value = n === 0 ? '' : String(n);
      }
    });
    document.addEventListener('focusout', function (e) {
      var el = e.target;
      if (el && el.tagName === 'INPUT' && el.dataset && el.dataset.money === 'true') {
        el.value = formatNumber(parseNumber(el.value));
      }
    });
  }

  // ---------------------------------------------------------------------
  // 데이터 가져오기 (JSON): 세금계산서 등에서 미리 뽑아낸 데이터를 표에 채워 넣는다.
  // 파일 형식은 레코드 배열이며, 각 레코드는 { table: "subcontract"|"labor"|"etc", ... }
  // 형태로 어느 표에 들어갈지 지정하고, 그 표의 컬럼명과 같은 키로 값을 채운다.
  // 부가세/합계 등 계산되는 값은 넣지 않아도 되며(넣어도 무시됨), 항상 공급가액 등
  // 원본 입력값으로부터 다시 계산한다.
  // ---------------------------------------------------------------------
  function makeRowFromImport(tableName, rec) {
    var row;
    if (tableName === 'subcontract') {
      row = makeSubcontractRow(state.subcontractNextId++);
      row.workType = rec.workType || '';
      row.issueDate = rec.issueDate || '';
      row.vendor = rec.vendor || '';
      row.bizRegNo = formatBizRegNo(rec.bizRegNo || '');
      row.supplyAmount = parseNumber(rec.supplyAmount);
      row.taxInvoiceIssued = !!rec.taxInvoiceIssued;
      row.bank = rec.bank || '';
      row.payDate = rec.payDate || '';
      row.accountInfo = rec.accountInfo || '';
      row.contact = rec.contact || '';
      row.note = rec.note || '';
      // 결제금액은 실제로 결제했을 때 사용자가 직접 적는 칸이므로 가져오기 시점에는
      // 채우지 않는다(0으로 남겨 잔액=합계 전체가 미결제 상태로 표시되게 한다).
    } else if (tableName === 'labor') {
      row = makeLaborRow(state.laborNextId++);
      row.issueDate = rec.issueDate || '';
      row.workerName = rec.workerName || '';
      row.item = rec.item || '';
      row.supplyAmount = parseNumber(rec.supplyAmount);
      row.withholdingTax = parseNumber(rec.withholdingTax);
    } else if (tableName === 'etc') {
      row = makeEtcRow(state.etcNextId++);
      row.issueDate = rec.issueDate || '';
      row.vendor = rec.vendor || '';
      row.item = rec.item || '';
      row.supplyAmount = parseNumber(rec.supplyAmount);
      row.vat = parseNumber(rec.vat);
    }
    return row;
  }

  function importFromRecords(records) {
    if (!Array.isArray(records)) {
      alert('가져오기 파일 형식이 올바르지 않습니다 (JSON 배열이어야 합니다).');
      return;
    }
    var counts = { subcontract: 0, labor: 0, etc: 0, skipped: 0 };
    records.forEach(function (rec) {
      var tableName = rec && rec.table;
      if (tableName !== 'subcontract' && tableName !== 'labor' && tableName !== 'etc') {
        counts.skipped++;
        return;
      }
      var row = makeRowFromImport(tableName, rec);
      state[tableName].push(row);
      counts[tableName]++;
    });
    onStateChange();
    var msg = '가져오기 완료 — 외주·자재비 ' + counts.subcontract + '건, 노무비 ' + counts.labor + '건, 기타 협회 및 보증서 ' + counts.etc + '건을 추가했습니다.';
    if (counts.skipped) msg += '\n형식이 맞지 않아 건너뛴 항목: ' + counts.skipped + '건';
    alert(msg);
  }

  function bindImport() {
    var btn = document.getElementById('btn-import');
    var fileInput = document.getElementById('import-file-input');
    if (!btn || !fileInput) return;

    btn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function () {
        var records;
        try {
          records = JSON.parse(reader.result);
        } catch (e) {
          alert('JSON 파일을 읽는 데 실패했습니다. 파일 형식을 확인해주세요.');
          return;
        }
        importFromRecords(records);
      };
      reader.onerror = function () {
        alert('파일을 읽는 데 실패했습니다.');
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  // ---------------------------------------------------------------------
  // 데이터 폴더 연결
  //
  // 크롬/엣지 등 File System Access API를 지원하는 브라우저에서는 폴더를 통째로
  // 연결해 그 안의 .json 파일 목록을 보여주고 골라서 가져올 수 있다. 연결한
  // 폴더 핸들은 IndexedDB에 저장해두어, 다음에 열었을 때 폴더를 다시 찾아 헤맬
  // 필요 없이 "다시 연결" 버튼(권한 재확인)만으로 이어서 쓸 수 있게 한다.
  // 이 API를 지원하지 않는 브라우저(파이어폭스/사파리 등)에서는 폴더 선택
  // input(webkitdirectory)으로 대체한다 — 이 경우 폴더 핸들을 저장할 수 없어
  // 열 때마다 다시 선택해야 한다.
  // ---------------------------------------------------------------------
  var FOLDER_DB_NAME = 'settlement-app-db';
  var FOLDER_DB_STORE = 'handles';
  var FOLDER_DB_KEY = 'dataFolder';
  var connectedDirHandle = null;

  function supportsFsAccess() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function openFolderDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(FOLDER_DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(FOLDER_DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveFolderHandle(handle) {
    return openFolderDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(FOLDER_DB_STORE, 'readwrite');
        tx.objectStore(FOLDER_DB_STORE).put(handle, FOLDER_DB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function loadFolderHandle() {
    return openFolderDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(FOLDER_DB_STORE, 'readonly');
        var req = tx.objectStore(FOLDER_DB_STORE).get(FOLDER_DB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function setFolderStatus(text) {
    var el = document.getElementById('folder-status');
    if (el) el.textContent = text;
  }

  function renderFolderFileList(items) {
    var ul = document.getElementById('folder-file-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'folder-empty';
      empty.textContent = '폴더에서 .json 파일을 찾지 못했습니다.';
      ul.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'folder-file-item';

      var nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '가져오기';
      btn.addEventListener('click', function () {
        item.read().then(function (text) {
          var records;
          try {
            records = JSON.parse(text);
          } catch (e) {
            alert('"' + item.name + '" 파일을 읽는 데 실패했습니다 (JSON 형식 오류).');
            return;
          }
          importFromRecords(records);
        }).catch(function (err) {
          alert('"' + item.name + '" 파일을 읽는 데 실패했습니다: ' + (err && err.message ? err.message : err));
        });
      });

      li.appendChild(nameSpan);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  async function scanDirHandle(dirHandle) {
    var entries = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && /\.json$/i.test(entry.name)) {
        entries.push(entry);
      }
    }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return entries.map(function (entry) {
      return {
        name: entry.name,
        read: function () {
          return entry.getFile().then(function (file) { return file.text(); });
        }
      };
    });
  }

  function onFolderError(err) {
    if (err && err.name === 'AbortError') return; // 사용자가 폴더 선택을 취소함
    if (err && err.name === 'PermissionDenied') {
      alert('폴더 접근 권한이 거부되었습니다.');
      return;
    }
    alert('폴더를 여는 데 실패했습니다: ' + (err && err.message ? err.message : err));
  }

  function useDirHandle(dirHandle) {
    connectedDirHandle = dirHandle;
    setFolderStatus('연결됨: ' + dirHandle.name);
    saveFolderHandle(dirHandle).catch(function () { /* 저장 실패해도 이번 세션은 계속 사용 가능 */ });
    return scanDirHandle(dirHandle).then(renderFolderFileList);
  }

  // "폴더 연결": 이전에 연결한 폴더가 있으면 그 폴더의 권한만 다시 확인해서 이어서
  // 쓴다(브라우저가 폴더 선택 창을 다시 띄우지 않음). 처음 연결하는 경우에만 폴더
  // 선택 창이 뜬다.
  function connectFolder() {
    if (!supportsFsAccess()) {
      var fallbackInput = document.getElementById('folder-input-fallback');
      if (fallbackInput) fallbackInput.click();
      return;
    }

    var request = connectedDirHandle
      ? connectedDirHandle.requestPermission({ mode: 'read' }).then(function (perm) {
          if (perm !== 'granted') throw { name: 'PermissionDenied' };
          return connectedDirHandle;
        })
      : window.showDirectoryPicker({ mode: 'read' });

    Promise.resolve(request).then(useDirHandle).catch(onFolderError);
  }

  // "다른 폴더 선택": 이미 연결된 폴더가 있어도 항상 새 폴더 선택 창을 띄운다.
  function pickNewFolder() {
    if (!supportsFsAccess()) {
      var fallbackInput = document.getElementById('folder-input-fallback');
      if (fallbackInput) fallbackInput.click();
      return;
    }
    window.showDirectoryPicker({ mode: 'read' }).then(useDirHandle).catch(onFolderError);
  }

  function refreshFolder() {
    if (supportsFsAccess() && connectedDirHandle) {
      scanDirHandle(connectedDirHandle).then(renderFolderFileList).catch(function (err) {
        alert('폴더를 다시 읽는 데 실패했습니다: ' + (err && err.message ? err.message : err));
      });
    } else {
      connectFolder();
    }
  }

  function bindFolderFallbackInput() {
    var input = document.getElementById('folder-input-fallback');
    if (!input) return;
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files).filter(function (f) {
        return /\.json$/i.test(f.name);
      });
      if (!input.files.length) return;
      var folderName = input.files[0].webkitRelativePath
        ? input.files[0].webkitRelativePath.split('/')[0]
        : '선택한 폴더';
      setFolderStatus('연결됨: ' + folderName + ' (이 브라우저는 폴더를 기억하지 못해 다음에 열 때 다시 선택해야 합니다)');
      var items = files.map(function (f) {
        return { name: f.name, read: function () { return f.text(); } };
      });
      renderFolderFileList(items);
      input.value = '';
    });
  }

  function bindFolderButtons() {
    var connectBtn = document.getElementById('btn-connect-folder');
    var changeBtn = document.getElementById('btn-change-folder');
    var refreshBtn = document.getElementById('btn-refresh-folder');
    if (connectBtn) connectBtn.addEventListener('click', connectFolder);
    if (changeBtn) changeBtn.addEventListener('click', pickNewFolder);
    if (refreshBtn) refreshBtn.addEventListener('click', refreshFolder);
    bindFolderFallbackInput();
  }

  function tryReconnectFolder() {
    if (!supportsFsAccess()) return;
    loadFolderHandle().then(function (handle) {
      if (!handle) return;
      return handle.queryPermission({ mode: 'read' }).then(function (perm) {
        connectedDirHandle = handle;
        if (perm === 'granted') {
          setFolderStatus('연결됨: ' + handle.name);
          return scanDirHandle(handle).then(renderFolderFileList);
        }
        setFolderStatus('이전에 연결한 폴더: ' + handle.name + ' (다시 연결하려면 "폴더 연결" 버튼을 눌러주세요)');
      });
    }).catch(function () { /* 저장된 연결 정보가 없거나 접근할 수 없음 - 무시 */ });
  }

  function bindActionButtons() {
    var addButtons = document.querySelectorAll('[data-add-row]');
    for (var i = 0; i < addButtons.length; i++) {
      addButtons[i].addEventListener('click', function (e) {
        addRow(e.currentTarget.getAttribute('data-add-row'));
      });
    }

    document.getElementById('btn-reset').addEventListener('click', function () {
      var ok = confirm('모든 입력 데이터를 초기화하시겠습니까?');
      if (!ok) return;
      try { localStorage.removeItem(STATE_KEY); } catch (e) { /* 무시 */ }
      state = createEmptyState();
      renderAll();
    });

    document.getElementById('btn-export').addEventListener('click', exportToExcel);

    var themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  }

  // ---------------------------------------------------------------------
  // 엑셀 내보내기 (ExcelJS: 테두리·헤더 음영·소계 강조·숫자 서식이 실제로 적용된
  // .xlsx를 생성한다. SheetJS 무료판은 스타일 저장을 지원하지 않아 표 형태로
  // 꾸밀 수 없어서 ExcelJS로 교체했다.)
  // ---------------------------------------------------------------------
  var XLSX_COL_COUNT = 16;
  var XLSX_THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  var XLSX_BORDER = { top: XLSX_THIN, left: XLSX_THIN, bottom: XLSX_THIN, right: XLSX_THIN };
  var XLSX_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5E5' } };
  var XLSX_SUBTOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  var XLSX_HIGHLIGHT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAFB' } };

  function styleXlsxRow(row, colCount, opts) {
    opts = opts || {};
    for (var c = 1; c <= colCount; c++) {
      var cell = row.getCell(c);
      cell.border = XLSX_BORDER;
      if (opts.bold) cell.font = { bold: true };
      if (opts.fill) cell.fill = opts.fill;
      if (opts.center) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (opts.moneyCols && opts.moneyCols.indexOf(c) !== -1) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }
  }

  function addXlsxSectionTitle(ws, text) {
    var row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, XLSX_COL_COUNT);
    row.getCell(1).font = { bold: true, size: 12 };
    return row;
  }

  async function exportToExcel() {
    if (typeof ExcelJS === 'undefined') {
      alert('엑셀 내보내기 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
      return;
    }

    var projSupply = Number(state.projectInfo.supplyAmount) || 0;
    var projVat = calcVat(projSupply);
    var projTotal = calcTotal(projSupply, projVat);
    var sub = subcontractSubtotal();
    var lab = laborSubtotal();
    var etc = etcSubtotal();

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('정산서');
    ws.columns = [
      { width: 6 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 16 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 18 }, { width: 14 }, { width: 14 }
    ];

    // 제목
    var titleRow = ws.addRow(['현장정산서']);
    ws.mergeCells(titleRow.number, 1, titleRow.number, XLSX_COL_COUNT);
    titleRow.getCell(1).font = { bold: true, size: 16 };
    titleRow.height = 26;
    ws.addRow([]);

    // 상단 정보
    [
      ['공사명', state.projectInfo.name],
      ['공급가액', projSupply],
      ['부가세', projVat],
      ['합계(계약금액)', projTotal]
    ].forEach(function (pair) {
      var r = ws.addRow(pair);
      r.getCell(1).font = { bold: true };
      if (typeof pair[1] === 'number') r.getCell(2).numFmt = '#,##0';
    });
    ws.addRow([]);

    // 1. 외주·자재비
    addXlsxSectionTitle(ws, '1. 외주·자재비');
    var header1 = ws.addRow(['순번', '공종', '발행일', '거래처', '사업자등록번호', '공급가액', '부가세', '합계', '전자세금계산서', '결제은행', '결제일', '결제금액', '잔액', '계좌정보', '연락처', '비고']);
    styleXlsxRow(header1, 16, { bold: true, fill: XLSX_HEADER_FILL, center: true });

    state.subcontract.forEach(function (row, idx) {
      var vat = calcVat(row.supplyAmount);
      var total = calcTotal(row.supplyAmount, vat);
      var balance = total - (Number(row.paidAmount) || 0);
      var r = ws.addRow([idx + 1, row.workType, row.issueDate, row.vendor, row.bizRegNo, row.supplyAmount, vat, total, row.taxInvoiceIssued ? 'O' : '', row.bank, row.payDate, row.paidAmount, balance, row.accountInfo, row.contact, row.note]);
      styleXlsxRow(r, 16, { moneyCols: [6, 7, 8, 12, 13] });
    });
    var sub1 = ws.addRow(['소계', '', '', '', '', sub.supplyAmount, sub.vat, sub.total, '', '', '', '', '', '', '', '']);
    ws.mergeCells(sub1.number, 1, sub1.number, 5);
    styleXlsxRow(sub1, 16, { bold: true, fill: XLSX_SUBTOTAL_FILL, moneyCols: [6, 7, 8] });
    ws.addRow([]);

    // 2. 노무비
    addXlsxSectionTitle(ws, '2. 노무비');
    var header2 = ws.addRow(['순번', '발행일', '인부명', '항목', '공급가액', '원천세', '합계']);
    styleXlsxRow(header2, 7, { bold: true, fill: XLSX_HEADER_FILL, center: true });

    state.labor.forEach(function (row, idx) {
      var total = (Number(row.supplyAmount) || 0) - (Number(row.withholdingTax) || 0);
      var r = ws.addRow([idx + 1, row.issueDate, row.workerName, row.item, row.supplyAmount, row.withholdingTax, total]);
      styleXlsxRow(r, 7, { moneyCols: [5, 6, 7] });
    });
    var sub2 = ws.addRow(['소계', '', '', '', lab.supplyAmount, lab.withholdingTax, lab.total]);
    ws.mergeCells(sub2.number, 1, sub2.number, 4);
    styleXlsxRow(sub2, 7, { bold: true, fill: XLSX_SUBTOTAL_FILL, moneyCols: [5, 6, 7] });
    ws.addRow([]);

    // 3. 기타 협회 및 보증서
    addXlsxSectionTitle(ws, '3. 기타 협회 및 보증서');
    var header3 = ws.addRow(['순번', '발행일', '거래처', '항목', '공급가액', '부가세', '합계']);
    styleXlsxRow(header3, 7, { bold: true, fill: XLSX_HEADER_FILL, center: true });

    state.etc.forEach(function (row, idx) {
      var total = (Number(row.supplyAmount) || 0) + (Number(row.vat) || 0);
      var r = ws.addRow([idx + 1, row.issueDate, row.vendor, row.item, row.supplyAmount, row.vat, total]);
      styleXlsxRow(r, 7, { moneyCols: [5, 6, 7] });
    });
    var sub3 = ws.addRow(['소계', '', '', '', etc.supplyAmount, etc.vat, etc.total]);
    ws.mergeCells(sub3.number, 1, sub3.number, 4);
    styleXlsxRow(sub3, 7, { bold: true, fill: XLSX_SUBTOTAL_FILL, moneyCols: [5, 6, 7] });
    ws.addRow([]);

    // 요약 A. 세금계산서 대비 지출 비교
    var laborRowA = { supplyAmount: lab.supplyAmount, vat: 0, total: lab.total };
    addXlsxSectionTitle(ws, '요약 A. 세금계산서 대비 지출 비교');
    var headerA = ws.addRow(['구분', '공급가액', '부가세', '합계']);
    styleXlsxRow(headerA, 4, { bold: true, fill: XLSX_HEADER_FILL, center: true });

    [
      ['세금계산서발행금액', projSupply, projVat, projTotal],
      ['매입자료금액', sub.supplyAmount, sub.vat, sub.total],
      ['노무비', laborRowA.supplyAmount, laborRowA.vat, laborRowA.total],
      ['기타보증서', etc.supplyAmount, etc.vat, etc.total]
    ].forEach(function (vals) {
      var r = ws.addRow(vals);
      styleXlsxRow(r, 4, { moneyCols: [2, 3, 4] });
    });
    var marginRow = ws.addRow([
      '잔여마진',
      projSupply - sub.supplyAmount - laborRowA.supplyAmount - etc.supplyAmount,
      projVat - sub.vat - laborRowA.vat - etc.vat,
      projTotal - sub.total - laborRowA.total - etc.total
    ]);
    styleXlsxRow(marginRow, 4, { bold: true, fill: XLSX_HIGHLIGHT_FILL, moneyCols: [2, 3, 4] });
    ws.addRow([]);

    // 요약 B. 수익 정산표
    var techFee = round(projSupply * 0.05);
    var expense = etc.supplyAmount;
    var purchaseAmount = sub.supplyAmount;
    var laborTotal = lab.total;
    var remainAmount = projSupply - techFee - expense - purchaseAmount - laborTotal;

    addXlsxSectionTitle(ws, '요약 B. 수익 정산표');
    [
      ['공급가액', projSupply, ''],
      ['기술료', techFee, '공급가액 × 5%'],
      ['경비', expense, '건설공제조합/전력 및 수도광열비 등'],
      ['매입액', purchaseAmount, ''],
      ['노무비', laborTotal, '']
    ].forEach(function (vals) {
      var r = ws.addRow(vals);
      styleXlsxRow(r, 3, { moneyCols: [2] });
    });
    var remainRow = ws.addRow(['잔여금액', remainAmount, '']);
    styleXlsxRow(remainRow, 3, { bold: true, fill: XLSX_HIGHLIGHT_FILL, moneyCols: [2] });
    ws.addRow([]);

    // 계좌 정보
    var acctRow = ws.addRow(['입금 계좌', (state.account.bankName || '') + ' ' + (state.account.accountNumber || '')]);
    acctRow.getCell(1).font = { bold: true };

    var namePart = sanitizeFilenamePart(state.projectInfo.name);
    var filename = namePart ? ('현장정산서_' + namePart + '.xlsx') : '현장정산서.xlsx';

    var buffer = await wb.xlsx.writeBuffer();
    var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------------------------------------------------------------------
  // 초기화
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    state = loadState();

    bindSimpleInputs();
    bindTableEvents('subcontract-body', 'subcontract');
    bindTableEvents('labor-body', 'labor');
    bindTableEvents('etc-body', 'etc');
    bindActionButtons();
    bindImport();
    bindFolderButtons();
    bindMoneyFormatting();
    bindDatePickers();
    bindProjectPicker();

    updateThemeToggleIcon(document.documentElement.getAttribute('data-theme'));
    SettlementShared.showChangelogIfNeeded();
    if (!supportsFsAccess()) {
      setFolderStatus('이 브라우저는 폴더 연결을 지원하지 않아 "폴더 연결" 버튼이 폴더 선택 창으로 대체됩니다.');
    }
    tryReconnectFolder();

    renderAll();
  });
})();
