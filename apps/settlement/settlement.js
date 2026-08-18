(function () {
  'use strict';

  var STATE_KEY = 'settlement-app-state';
  var THEME_KEY = 'settlement-app-theme';

  var state = null;

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
  // 상태(state) 초기값
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
      paidAmountTouched: false,
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
  // localStorage 저장/복원
  // ---------------------------------------------------------------------
  function saveToLocalStorage() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable - 무시 */
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
  // 다크모드 (js/theme.js 패턴을 별도 localStorage 키로 자체 구현)
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

  // 페이지 렌더 전에 즉시 적용해 깜빡임을 방지한다.
  applyTheme(getPreferredTheme());

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
    var paidInput = tr.querySelector('[data-field="paidAmount"]');

    if (vatCell) vatCell.textContent = formatNumber(vat);
    if (totalCell) totalCell.textContent = formatNumber(total);

    if (paidInput && !row.paidAmountTouched && document.activeElement !== paidInput) {
      paidInput.value = formatNumber(row.paidAmount);
    }

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
      if (tableName === 'subcontract' && field === 'supplyAmount' && !row.paidAmountTouched) {
        var vat = calcVat(row.supplyAmount);
        row.paidAmount = calcTotal(row.supplyAmount, vat);
      }
      if (tableName === 'subcontract' && field === 'paidAmount') {
        row.paidAmountTouched = true;
      }
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
    bindMoneyFormatting();
    bindDatePickers();

    updateThemeToggleIcon(document.documentElement.getAttribute('data-theme'));

    renderAll();
  });
})();
