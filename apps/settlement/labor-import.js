// labor-import.js — 노무비 대장(엑셀)을 읽어 「2. 노무비」 표에 자동으로 채운다.
//
// 동작 방식
// - .xls / .xlsx 모두 읽기 위해 SheetJS(xlsx)를 버튼을 누를 때 한 번만 불러온다.
// - 시트마다 "성명" 제목 칸을 찾아 그 행(과 바로 아래 행)의 제목으로 열 위치를 정한다.
//   (노무비 총액 / 공제합계·세액계 / 차감지급액·실지급액 / 직종·공종 / 일당·단가 / 출력일수·총공수)
//   양식마다 열 순서가 달라도 제목 이름으로 찾기 때문에 그대로 읽힌다.
// - 대장은 보통 한 사람이 2줄을 쓰므로, "제목 2줄째"에 있는 항목(예: 세액계 아래 차감지급액)은
//   그 사람의 2줄째 값에서 읽는다.
// - 표에 들어가는 값: 인부명=성명, 항목=직종·출력일수·일당, 공급가액=노무비 총액,
//   원천세=노무비 총액-차감지급액(공제합계). 따라서 「합계」 칸 = 차감지급액이 된다.
(function (root) {
  'use strict';

  var SHEETJS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  // ------------------------------------------------------------------
  // 파서 (DOM 없이 2차원 배열만 다룬다 — 테스트하기 쉽게 분리)
  // ------------------------------------------------------------------
  function norm(v) {
    return String(v == null ? '' : v).replace(/\s+/g, '');
  }

  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/[,\s원]/g, '');
    if (s === '' || s === '-') return 0;
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  // 각 항목을 찾는 규칙(앞에 있는 규칙이 우선)
  var FIELD_RULES = {
    name: [function (n) { return n === '성명' || n === '이름' || n === '인부명'; }],
    type: [function (n) { return n === '직종' || n === '공종' || n === '직책' || n === '품명'; }],
    price: [function (n) { return n === '일당' || n === '노무비단가' || n === '단가' || n === '일당단가'; },
            function (n) { return n.indexOf('단가') !== -1 && n.indexOf('총액') === -1; }],
    days: [function (n) { return n === '출력일수' || n === '출역일수'; },
           function (n) { return n === '총공수'; },
           function (n) { return n === '총일수' || n === '근무일수' || n === '일수'; }],
    gross: [function (n) { return n.indexOf('노무비총액') !== -1; },
            function (n) { return n === '총액' || n === '노무비'; }],
    deduction: [function (n) { return n.indexOf('공제합계') !== -1 || n === '세액계' || n === '공제액' || n === '공제계'; }],
    net: [function (n) { return n.indexOf('차감지급액') !== -1 || n.indexOf('실지급액') !== -1; }]
  };

  function findHeaderRow(grid) {
    var limit = Math.min(grid.length, 60);
    for (var r = 0; r < limit; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (FIELD_RULES.name[0](norm(row[c]))) return { row: r, nameCol: c };
      }
    }
    return null;
  }

  // 제목 2줄(header, header+1)을 보고 항목별 {열, 줄 위치(0/1)}를 정한다.
  function mapColumns(grid, headerRow) {
    var lines = [grid[headerRow] || [], grid[headerRow + 1] || []];
    var found = {};
    Object.keys(FIELD_RULES).forEach(function (key) {
      var rules = FIELD_RULES[key];
      for (var p = 0; p < rules.length && !found[key]; p++) {
        for (var off = 0; off < 2 && !found[key]; off++) {
          var line = lines[off];
          for (var c = 0; c < line.length; c++) {
            var n = norm(line[c]);
            if (n && rules[p](n)) { found[key] = { col: c, off: off }; break; }
          }
        }
      }
    });
    return found;
  }

  var STOP_WORDS = /합계|총계|소계|누계|^계$/;

  function looksLikeName(v) {
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (s.length < 2 || s.length > 12) return false;
    if (/[0-9#=]/.test(s)) return false;
    if (STOP_WORDS.test(norm(s))) return false;
    return /[가-힣A-Za-z]/.test(s);
  }

  function cellAt(grid, r, spec) {
    if (!spec) return '';
    var row = grid[r + spec.off] || [];
    return row[spec.col];
  }

  // 대장 제목/기간 칸에서 "2026년 06월" 같은 연월을 찾아 그 달의 말일(YYYY-MM-DD)을 돌려준다.
  function detectPeriod(grid, headerRow, sheetName) {
    var top = Math.min(grid.length, headerRow + 1);
    for (var r = 0; r < top; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (v instanceof Date && !isNaN(v)) return lastDayOf(v.getFullYear(), v.getMonth() + 1);
        var m = String(v == null ? '' : v).match(/(20\d{2})\s*[년.\-\/]\s*(\d{1,2})\s*월?/);
        if (m) {
          var mon = Number(m[2]);
          if (mon >= 1 && mon <= 12) return lastDayOf(Number(m[1]), mon);
        }
      }
    }
    return '';
  }

  function lastDayOf(y, m) {
    var d = new Date(y, m, 0).getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  function formatComma(n) {
    return Math.round(Number(n) || 0).toLocaleString('ko-KR');
  }

  function buildItem(type, days, price) {
    var parts = [];
    if (type) parts.push(type);
    if (days) parts.push(String(Math.round(days * 100) / 100) + '일');
    var text = parts.join(' ');
    if (price) text += (text ? ' × ' : '') + formatComma(price);
    return text;
  }

  // grid(2차원 배열) 하나를 읽어 노무비 행 목록으로 바꾼다.
  function parseGrid(grid, sheetName) {
    var header = findHeaderRow(grid);
    if (!header) return { ok: false, reason: '"성명" 제목 칸을 찾지 못했습니다.', rows: [] };

    var cols = mapColumns(grid, header.row);
    if (!cols.gross) return { ok: false, reason: '"노무비 총액" 제목 칸을 찾지 못했습니다.', rows: [] };

    var rows = [];
    for (var r = header.row + 1; r < grid.length; r++) {
      var nameRaw = cellAt(grid, r, cols.name);
      var nameNorm = norm(nameRaw);
      if (nameNorm && STOP_WORDS.test(nameNorm)) break; // 합계 줄에서 멈춘다
      if (!looksLikeName(nameRaw)) continue;

      var gross = toNum(cellAt(grid, r, cols.gross));
      if (gross <= 0) continue;

      var net = cols.net ? toNum(cellAt(grid, r, cols.net)) : 0;
      var deduction = cols.deduction ? toNum(cellAt(grid, r, cols.deduction)) : 0;
      var withholding;
      if (cols.net && net > 0 && net <= gross) withholding = gross - net;
      else withholding = deduction;

      var type = cols.type ? String(cellAt(grid, r, cols.type) || '').replace(/\s+/g, '') : '';
      if (/^[0-9.\-]+$/.test(type)) type = '';
      var days = cols.days ? toNum(cellAt(grid, r, cols.days)) : 0;
      var price = cols.price ? toNum(cellAt(grid, r, cols.price)) : 0;

      rows.push({
        workerName: String(nameRaw).trim(),
        item: buildItem(type, days, price),
        supplyAmount: Math.round(gross),
        withholdingTax: Math.round(withholding),
        net: Math.round(gross - withholding)
      });
    }

    return {
      ok: rows.length > 0,
      reason: rows.length ? '' : '노무비 총액이 있는 인부 행을 찾지 못했습니다.',
      rows: rows,
      period: detectPeriod(grid, header.row, sheetName)
    };
  }

  var api = { parseGrid: parseGrid, norm: norm, toNum: toNum };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.LaborImport = api;

  // ------------------------------------------------------------------
  // 화면(UI)
  // ------------------------------------------------------------------
  var doc = root.document;
  var sheetJsPromise = null;
  var current = null; // { fileName, sheets: [{name, result}] }

  function loadSheetJs() {
    if (root.XLSX) return Promise.resolve(root.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = SHEETJS_URL;
      s.onload = function () { root.XLSX ? resolve(root.XLSX) : reject(new Error('load')); };
      s.onerror = function () { sheetJsPromise = null; reject(new Error('load')); };
      doc.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  function injectStyles() {
    var css =
      '.labor-import-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.6rem}' +
      '.labor-import-panel{margin-top:.9rem;border:1px dashed var(--color-accent,#2563eb);border-radius:10px;padding:1rem}' +
      '.labor-import-panel h3{margin:0 0 .6rem;font-size:1rem}' +
      '.labor-import-grid{display:flex;flex-wrap:wrap;gap:.75rem 1rem;align-items:flex-end;margin-bottom:.75rem}' +
      '.labor-import-grid label{display:flex;flex-direction:column;gap:.25rem;font-size:.85rem;font-weight:600}' +
      '.labor-import-grid select,.labor-import-grid input[type=date]{min-width:180px}' +
      '.labor-import-mode{display:flex;gap:1rem;flex-wrap:wrap;font-size:.88rem;margin-bottom:.75rem}' +
      '.labor-import-mode label{display:flex;align-items:center;gap:.35rem;font-weight:400}' +
      '.labor-import-msg{font-size:.85rem;margin:.25rem 0 .75rem;opacity:.85}' +
      '.labor-import-msg.is-error{color:#dc2626;opacity:1}' +
      '.labor-import-preview td.num,.labor-import-preview th.num{text-align:right}' +
      '.labor-import-preview tfoot td{font-weight:700}' +
      '.labor-import-buttons{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}';
    var style = doc.createElement('style');
    style.textContent = css;
    doc.head.appendChild(style);
  }

  function el(tag, attrs, text) {
    var e = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'className') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  var ui = {};

  function buildUi() {
    var section = doc.getElementById('table-labor');
    if (!section) return false;
    var addBtn = section.querySelector('[data-add-row="labor"]');

    var actions = el('div', { className: 'labor-import-actions' });
    if (addBtn) { addBtn.parentNode.insertBefore(actions, addBtn); actions.appendChild(addBtn); }
    else section.appendChild(actions);

    ui.btn = el('button', { type: 'button', className: 'btn-secondary' }, '📥 노무비 대장 엑셀 불러오기');
    ui.file = el('input', { type: 'file', accept: '.xls,.xlsx,.xlsm', hidden: '' });
    actions.appendChild(ui.btn);
    actions.appendChild(ui.file);

    ui.panel = el('div', { className: 'labor-import-panel', hidden: '' });
    ui.panel.appendChild(el('h3', null, '노무비 대장 미리보기'));
    ui.msg = el('p', { className: 'labor-import-msg' });
    ui.panel.appendChild(ui.msg);

    var grid = el('div', { className: 'labor-import-grid' });
    var sheetLabel = el('label', null, '시트 선택');
    ui.sheet = el('select');
    sheetLabel.appendChild(ui.sheet);
    var dateLabel = el('label', null, '발행일(지급일)');
    ui.date = el('input', { type: 'date' });
    dateLabel.appendChild(ui.date);
    grid.appendChild(sheetLabel);
    grid.appendChild(dateLabel);
    ui.panel.appendChild(grid);

    var mode = el('div', { className: 'labor-import-mode' });
    var l1 = el('label');
    ui.modeAppend = el('input', { type: 'radio', name: 'labor-import-mode', value: 'append', checked: '' });
    l1.appendChild(ui.modeAppend); l1.appendChild(doc.createTextNode('기존 노무비 아래에 추가'));
    var l2 = el('label');
    ui.modeReplace = el('input', { type: 'radio', name: 'labor-import-mode', value: 'replace' });
    l2.appendChild(ui.modeReplace); l2.appendChild(doc.createTextNode('기존 노무비를 지우고 새로 채우기'));
    mode.appendChild(l1); mode.appendChild(l2);
    ui.panel.appendChild(mode);

    var scroll = el('div', { className: 'table-scroll' });
    ui.table = el('table', { className: 'labor-import-preview' });
    scroll.appendChild(ui.table);
    ui.panel.appendChild(scroll);

    var buttons = el('div', { className: 'labor-import-buttons' });
    ui.apply = el('button', { type: 'button', className: 'btn-primary' }, '노무비 표에 채우기');
    ui.cancel = el('button', { type: 'button', className: 'btn-secondary' }, '취소');
    buttons.appendChild(ui.apply); buttons.appendChild(ui.cancel);
    ui.panel.appendChild(buttons);

    section.appendChild(ui.panel);
    return true;
  }

  function setMsg(text, isError) {
    ui.msg.textContent = text;
    ui.msg.classList.toggle('is-error', !!isError);
  }

  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function renderPreview() {
    var sheet = current && current.sheets[ui.sheet.selectedIndex];
    ui.table.innerHTML = '';
    if (!sheet) return;
    var res = sheet.result;

    var thead = el('thead');
    var hr = el('tr');
    ['순번', '인부명', '항목', '공급가액(노무비 총액)', '원천세(공제)', '합계(차감지급액)'].forEach(function (h, i) {
      hr.appendChild(el('th', i >= 3 ? { className: 'num' } : null, h));
    });
    thead.appendChild(hr);
    ui.table.appendChild(thead);

    var tbody = el('tbody');
    var s = 0, w = 0, t = 0;
    res.rows.forEach(function (row, idx) {
      var tr = el('tr');
      tr.appendChild(el('td', null, String(idx + 1)));
      tr.appendChild(el('td', null, row.workerName));
      tr.appendChild(el('td', null, row.item));
      tr.appendChild(el('td', { className: 'num' }, formatComma(row.supplyAmount)));
      tr.appendChild(el('td', { className: 'num' }, formatComma(row.withholdingTax)));
      tr.appendChild(el('td', { className: 'num' }, formatComma(row.net)));
      tbody.appendChild(tr);
      s += row.supplyAmount; w += row.withholdingTax; t += row.net;
    });
    ui.table.appendChild(tbody);

    var tfoot = el('tfoot');
    var fr = el('tr');
    var label = el('td', { colspan: '3' }, '합계 (' + res.rows.length + '명)');
    fr.appendChild(label);
    fr.appendChild(el('td', { className: 'num' }, formatComma(s)));
    fr.appendChild(el('td', { className: 'num' }, formatComma(w)));
    fr.appendChild(el('td', { className: 'num' }, formatComma(t)));
    tfoot.appendChild(fr);
    ui.table.appendChild(tfoot);

    ui.date.value = res.period || ui.date.value || todayStr();
    setMsg('"' + current.fileName + '" · ' + sheet.name + ' 시트에서 ' + res.rows.length +
      '명을 찾았습니다. 금액을 대장과 한 번 대조한 뒤 "노무비 표에 채우기"를 눌러주세요.' +
      (res.period ? '' : ' (대장에서 연월을 찾지 못해 발행일을 오늘로 넣었습니다. 필요하면 바꿔주세요.)'));
  }

  function openPanel(fileName, workbook, XLSX) {
    var sheets = [];
    workbook.SheetNames.forEach(function (name) {
      var ws = workbook.Sheets[name];
      if (!ws) return;
      var grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      var result = parseGrid(grid, name);
      if (result.ok) sheets.push({ name: name, result: result });
    });

    if (!sheets.length) {
      ui.panel.hidden = true;
      alert('"' + fileName + '"에서 노무비 대장을 찾지 못했습니다.\n"성명"과 "노무비 총액" 제목 칸이 있는 시트인지 확인해주세요.');
      return;
    }

    // 인원이 가장 많은 시트를 기본으로 고른다(집계표·요약 시트보다 실제 대장이 우선되도록).
    var best = 0;
    sheets.forEach(function (sh, i) { if (sh.result.rows.length > sheets[best].result.rows.length) best = i; });

    current = { fileName: fileName, sheets: sheets };
    ui.sheet.innerHTML = '';
    sheets.forEach(function (sh) {
      ui.sheet.appendChild(el('option', null, sh.name + ' (' + sh.result.rows.length + '명)'));
    });
    ui.sheet.selectedIndex = best;
    ui.date.value = '';
    ui.modeAppend.checked = true;
    renderPreview();
    ui.panel.hidden = false;
    if (ui.panel.scrollIntoView) ui.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onFileChosen() {
    var file = ui.file.files && ui.file.files[0];
    ui.file.value = '';
    if (!file) return;
    ui.btn.disabled = true;
    var oldText = ui.btn.textContent;
    ui.btn.textContent = '읽는 중…';

    loadSheetJs().then(function (XLSX) {
      return file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array', cellDates: true });
        openPanel(file.name, wb, XLSX);
      });
    }).catch(function (err) {
      alert(err && err.message === 'load'
        ? '엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'
        : '엑셀 파일을 읽는 데 실패했습니다: ' + (err && err.message ? err.message : err));
    }).then(function () {
      ui.btn.disabled = false;
      ui.btn.textContent = oldText;
    });
  }

  function applyImport() {
    var sheet = current && current.sheets[ui.sheet.selectedIndex];
    if (!sheet) return;
    // 정산서에 원래 있는 "데이터 가져오기(JSON)" 기능에 그대로 넘긴다.
    // (settlement.js를 고치지 않아도 저장·클라우드 동기화·요약 갱신이 기존 방식대로 처리된다.)
    var importInput = doc.getElementById('import-file-input');
    if (!importInput || typeof DataTransfer === 'undefined') {
      alert('정산서 화면과 연결하지 못했습니다. 페이지를 새로고침(Ctrl+F5)한 뒤 다시 시도해주세요.');
      return;
    }
    var replace = ui.modeReplace.checked;
    if (replace && !confirm('지금 노무비 표에 있는 행을 모두 지우고 대장 내용으로 새로 채웁니다. 계속할까요?')) return;

    if (replace) {
      var guard = 0, removeBtn;
      while ((removeBtn = doc.querySelector('#labor-body [data-remove-row="labor"]')) && guard++ < 1000) {
        removeBtn.click();
      }
    }

    var date = ui.date.value || '';
    var records = sheet.result.rows.map(function (row) {
      return {
        table: 'labor',
        issueDate: date,
        workerName: row.workerName,
        item: row.item,
        supplyAmount: row.supplyAmount,
        withholdingTax: row.withholdingTax
      };
    });

    var dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(records)], '노무비대장.json', { type: 'application/json' }));
    importInput.files = dt.files;
    importInput.dispatchEvent(new Event('change', { bubbles: true }));

    ui.panel.hidden = true;
    current = null;
  }

  function init() {
    if (!buildUi()) return;
    injectStyles();
    ui.btn.addEventListener('click', function () { ui.file.click(); });
    ui.file.addEventListener('change', onFileChosen);
    ui.sheet.addEventListener('change', renderPreview);
    ui.apply.addEventListener('click', applyImport);
    ui.cancel.addEventListener('click', function () { ui.panel.hidden = true; current = null; });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
