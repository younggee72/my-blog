// completed.js — "완료정산서" 탭: 정산 완료 처리된 공사명만 모아서 보여준다.
// 실제 데이터 저장소는 index.html/invoices.html과 완전히 같다
// (settlement-app-saved-projects + Firestore 'settlements' 컬렉션).
(function () {
  'use strict';

  var SettlementShared = window.SettlementShared;
  var calcVat = SettlementShared.calcVat;
  var calcTotal = SettlementShared.calcTotal;
  var formatNumber = SettlementShared.formatNumber;
  var escapeAttr = SettlementShared.escapeAttr;

  function renderCompletedList() {
    var tbody = document.getElementById('completed-body');
    var emptyMsg = document.getElementById('completed-empty');
    var dict = SettlementShared.loadSavedProjects();
    var names = SettlementShared.getCompletedProjectNames().sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    });

    if (names.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;

    var html = '';
    names.forEach(function (name) {
      var proj = dict[name] || {};
      var info = proj.projectInfo || {};
      var supply = Number(info.supplyAmount) || 0;
      var vat = calcVat(supply);
      var total = calcTotal(supply, vat);
      html +=
        '<tr>' +
        '<td>' + escapeAttr(name) + '</td>' +
        '<td>' + formatNumber(supply) + '</td>' +
        '<td>' + formatNumber(vat) + '</td>' +
        '<td>' + formatNumber(total) + '</td>' +
        '<td><button type="button" class="btn-row-action btn-edit-completed" data-name="' + escapeAttr(name) + '">수정</button></td>' +
        '</tr>';
    });
    tbody.innerHTML = html;

    var editButtons = tbody.querySelectorAll('.btn-edit-completed');
    for (var i = 0; i < editButtons.length; i++) {
      editButtons[i].addEventListener('click', function (e) {
        var name = e.currentTarget.getAttribute('data-name');
        sessionStorage.setItem('settlement-edit-target', name);
        window.location.href = 'index.html';
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', SettlementShared.toggleTheme);
    SettlementShared.updateThemeToggleIcon(document.documentElement.getAttribute('data-theme'));

    SettlementShared.pullProjectsFromCloud().then(function () {
      renderCompletedList();
    });
  });
})();
