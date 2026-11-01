// settlement-fixes.js — 현장정산서 보완 스크립트 (settlement.js 다음에 로드)
//
// 1) 공사명을 입력하는 도중(글자 하나 칠 때마다) "연", "연일 ㅈ" 같은 반쪽짜리
//    공사명으로 정산서가 따로 저장되던 문제를 막는다.
//    - 공사명 칸에 커서가 있는 동안에는 "저장된 정산서" 목록/클라우드에 올리지 않고,
//    - 입력을 마치고 칸을 벗어날 때(또는 Enter) 완성된 공사명으로 한 번만 저장한다.
//    (작업 중인 내용 자체는 settlement.js가 이 브라우저에 계속 자동 저장한다.)
//
// 2) 클라우드에서 "삭제됨(deleted: true)" 표시가 된 정산서를 이 브라우저의
//    저장 목록에서도 지워, 모든 컴퓨터의 불러오기 목록·완료정산서 탭에서 사라지게 한다.
//    삭제 표시된 문서에는 원래 내용(deletedState)이 남아 있어 필요하면 되살릴 수 있다.
(function () {
  'use strict';

  var Shared = window.SettlementShared;
  if (!Shared) return;

  var STATE_KEY = 'settlement-app-state';
  var nameInput = document.getElementById('project-name');

  // ---------------- 1) 공사명 입력 중 저장 막기 ----------------
  if (nameInput && typeof Shared.saveProjectByName === 'function') {
    var originalSave = Shared.saveProjectByName;

    Shared.saveProjectByName = function (name, projectState) {
      if (document.activeElement === nameInput) return; // 입력 중에는 건너뛴다
      return originalSave.call(Shared, name, projectState);
    };

    var commitName = function () {
      var raw = null;
      try { raw = localStorage.getItem(STATE_KEY); } catch (e) { /* 무시 */ }
      if (!raw) return;
      var st;
      try { st = JSON.parse(raw); } catch (e) { return; }
      var name = st && st.projectInfo && st.projectInfo.name;
      if (name && String(name).trim()) originalSave.call(Shared, name, st);
    };

    nameInput.addEventListener('change', commitName);
    nameInput.addEventListener('blur', function () { setTimeout(commitName, 0); });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) nameInput.blur();
    });
  }

  // ---------------- 2) 삭제 표시된 정산서를 로컬 목록에서 제거 ----------------
  var deletedNames = null;

  function removeDeletedLocally() {
    if (!deletedNames || !deletedNames.length) return;
    var dict = Shared.loadSavedProjects();
    var changed = false;
    deletedNames.forEach(function (n) {
      if (Object.prototype.hasOwnProperty.call(dict, n)) { delete dict[n]; changed = true; }
    });
    if (changed) Shared.saveSavedProjects(dict);

    var picker = document.getElementById('project-picker');
    if (picker) {
      Array.prototype.slice.call(picker.options).forEach(function (opt) {
        if (opt.value && deletedNames.indexOf(opt.value) !== -1) opt.remove();
      });
    }
  }

  function loadDeletedNames() {
    return Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
    ]).then(function (mods) {
      var app = mods[0].initializeApp({
        apiKey: 'AIzaSyAdyXmaN_rgxG_eCFA8jnuzvQabL8thLFk',
        authDomain: 'jicheon-construction.firebaseapp.com',
        projectId: 'jicheon-construction'
      }, 'settlement-fixes');
      var fs = mods[1];
      return fs.getDocs(fs.query(fs.collection(fs.getFirestore(app), 'settlements'), fs.where('deleted', '==', true)));
    }).then(function (snap) {
      var names = [];
      snap.forEach(function (d) { var x = d.data(); if (x && x.name) names.push(x.name); });
      return names;
    });
  }

  loadDeletedNames().then(function (names) {
    deletedNames = names;
    removeDeletedLocally();
    // 화면이 열릴 때 클라우드 병합이 늦게 끝나는 경우를 대비해 몇 번 더 정리한다.
    setTimeout(removeDeletedLocally, 3000);
    setTimeout(removeDeletedLocally, 10000);
    var picker = document.getElementById('project-picker');
    if (picker) picker.addEventListener('mousedown', removeDeletedLocally);
  }).catch(function (err) {
    console.warn('[settlement-fixes] 삭제 목록 조회 실패', err);
  });
})();
