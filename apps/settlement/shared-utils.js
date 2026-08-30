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
  var LAST_SEEN_VERSION_KEY = 'settlement-app-last-seen-version';

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
    pushProjectToCloud(name, projectState);
  }

  function getSavedProjectNames() {
    return Object.keys(loadSavedProjects());
  }

  // ---------------------------------------------------------------------
  // 클라우드 동기화(Firestore) — 정산서를 "이 브라우저에만"이 아니라
  // 회사 공유 저장소에 올려서, 비밀번호로 들어온 관계자라면 어느 기기에서든
  // 같은 정산서 목록을 보고 불러올 수 있게 한다.
  //
  // 기존 동기(synchronous) API(loadSavedProjects/saveProjectByName/
  // getSavedProjectNames)는 settlement.js/invoices.js 여러 곳에서 이미
  // 동기적으로 쓰고 있어 전부 async로 바꾸면 손댈 곳이 너무 많아진다.
  // 대신 "로컬은 그대로 즉시 저장 + 백그라운드로 클라우드에도 반영"
  // (push) 하고, 화면이 열릴 때 한 번 "클라우드 → 로컬" 병합(pull)을
  // 먼저 끝낸 뒤에 그 다음부터는 기존 동기 API를 그대로 쓰는 방식으로
  // 최소 침습적으로 붙인다.
  // ---------------------------------------------------------------------
  var firestoreCtxPromise = null;
  function getFirestoreCtx() {
    if (!firestoreCtxPromise) {
      firestoreCtxPromise = Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
      ]).then(function (mods) {
        var appMod = mods[0];
        var fsMod = mods[1];
        var firebaseConfig = {
          apiKey: 'AIzaSyAdyXmaN_rgxG_eCFA8jnuzvQabL8thLFk',
          authDomain: 'jicheon-construction.firebaseapp.com',
          projectId: 'jicheon-construction',
          storageBucket: 'jicheon-construction.firebasestorage.app',
          messagingSenderId: '79554524630',
          appId: '1:79554524630:web:67a2588607f85984c82077'
        };
        var app = appMod.initializeApp(firebaseConfig, 'settlement-cloud');
        var db = fsMod.getFirestore(app);
        return { db: db, fs: fsMod };
      });
    }
    return firestoreCtxPromise;
  }

  // Firestore 문서 ID는 "/" 등 일부 문자를 쓸 수 없으므로 안전한 값으로 치환한다.
  function sanitizeDocId(name) {
    var id = String(name).replace(/[\/\.#$\[\]]/g, '_').slice(0, 300);
    return id || 'unnamed';
  }

  // 정산서 하나를 클라우드에 올린다(실패해도 화면 동작은 막지 않는다 — fire-and-forget).
  function pushProjectToCloud(name, projectState) {
    getFirestoreCtx().then(function (ctx) {
      var docRef = ctx.fs.doc(ctx.db, 'settlements', sanitizeDocId(name));
      return ctx.fs.setDoc(docRef, {
        name: name,
        state: projectState,
        updatedAt: Date.now()
      });
    }).catch(function (err) {
      console.warn('[settlement] 클라우드 저장 실패(' + name + ')', err);
    });
  }

  // 클라우드에 있는 정산서 전체를 받아와 로컬 저장소에 병합한다.
  // 화면이 열릴 때 한 번 호출해 다른 기기/사람이 올린 정산서를 반영한다.
  function pullProjectsFromCloud() {
    return getFirestoreCtx().then(function (ctx) {
      return ctx.fs.getDocs(ctx.fs.collection(ctx.db, 'settlements'));
    }).then(function (snap) {
      var dict = loadSavedProjects();
      snap.forEach(function (docSnap) {
        var data = docSnap.data();
        if (data && data.name && data.state) {
          dict[data.name] = data.state;
        }
      });
      saveSavedProjects(dict);
      return dict;
    }).catch(function (err) {
      console.warn('[settlement] 클라우드 목록 조회 실패', err);
      return loadSavedProjects();
    });
  }

  // ---------------------------------------------------------------------
  // 업데이트 안내(changelog) — 앱이 업데이트될 때마다 이 배열 맨 앞에
  // 새 항목을 추가하면 된다(최신이 맨 앞). index.html과 invoices.html이
  // 이 파일 하나(그리고 localStorage 키 하나)를 공유하므로, 사용자가 둘 중
  // 어느 화면을 먼저 열어도 안내는 딱 한 번만 뜬다.
  // ---------------------------------------------------------------------
  var APP_CHANGELOG = [
    {
      version: '2.1',
      date: '2026-08-19',
      title: '계산서함이 새로 생겼어요',
      items: [
        '세금계산서 PDF·이미지·엑셀(.xlsx)을 업로드하거나 폴더로 연결하면 발행일·거래처·사업자등록번호·공급가액·부가세·합계를 자동으로 읽어옵니다.',
        '공사명별로 계산서를 모아서 정산서 작성 화면에 한 번에 반영(자동 생성)할 수 있습니다.',
        '정산서 작성 화면 상단에 "저장된 정산서 불러오기"가 추가되어, 여러 공사의 정산서를 한 화면에서 오가며 관리할 수 있습니다.'
      ]
    }
  ];

  function getLatestVersion() {
    return APP_CHANGELOG.length ? APP_CHANGELOG[0].version : null;
  }

  function getLastSeenVersion() {
    return localStorage.getItem(LAST_SEEN_VERSION_KEY);
  }

  function setLastSeenVersion(version) {
    try {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
    } catch (e) {
      /* storage unavailable - 무시 */
    }
  }

  // 모달에 쓰는 스타일은 이 함수가 처음 호출될 때 <style>로 한 번만 주입한다
  // (index.html/invoices.html 어느 쪽이 먼저 열려도 중복 삽입되지 않도록 id로 가드).
  function ensureChangelogStyles() {
    if (document.getElementById('settlement-changelog-style')) return;
    var style = document.createElement('style');
    style.id = 'settlement-changelog-style';
    style.textContent =
      '.settlement-changelog-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;padding:1rem;z-index:1000;}' +
      '.settlement-changelog-card{background:var(--color-bg);color:var(--color-text);' +
      'border:1px solid var(--color-border);border-radius:10px;max-width:440px;width:100%;' +
      'max-height:85vh;overflow-y:auto;padding:1.25rem 1.25rem 1.5rem;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.25);}' +
      '.settlement-changelog-card h2{margin:0 0 0.9rem;font-size:1.1rem;}' +
      '.settlement-changelog-entry{margin-bottom:1rem;}' +
      '.settlement-changelog-entry:last-of-type{margin-bottom:1.1rem;}' +
      '.settlement-changelog-entry h3{margin:0 0 0.5rem;font-size:0.98rem;color:var(--color-text);}' +
      '.settlement-changelog-meta{font-size:0.78rem;color:var(--color-text-secondary);margin:0 0 0.5rem;}' +
      '.settlement-changelog-entry ul{margin:0;padding-left:1.1rem;font-size:0.88rem;' +
      'color:var(--color-text-secondary);line-height:1.55;}' +
      '.settlement-changelog-entry li{margin-bottom:0.35rem;}' +
      '.settlement-changelog-close{display:block;width:100%;border:1px solid var(--color-accent);' +
      'background:var(--color-accent);color:#ffffff;border-radius:6px;padding:0.7rem 1rem;' +
      'font-size:0.95rem;cursor:pointer;min-height:44px;}' +
      '.settlement-changelog-close:hover{opacity:0.92;}';
    document.head.appendChild(style);
  }

  // "이 브라우저에 저장된 기존 데이터가 있는가"로 신규/기존 사용자를
  // 구분한다. last-seen-version 키 자체는 이번 업데이트에서 처음 생긴
  // 것이라, 예전부터 쓰던 사용자도 이 키만 보면 "처음 방문"으로 착각하기
  // 쉽다 — 실제로 이런 이유로 첫 배포 직후 기존 사용자에게 안내가 전혀
  // 안 뜨는 문제가 있었다. 정산서/계산서 상태가 이미 저장되어 있다면
  // "예전부터 쓰던 사용자"로 판단한다.
  function hasExistingAppData() {
    try {
      return !!(localStorage.getItem('settlement-app-state') ||
        localStorage.getItem('settlement-invoices-state') ||
        localStorage.getItem('settlement-app-saved-projects'));
    } catch (e) {
      return false;
    }
  }

  // 확인하지 않은(마지막으로 본 버전 이후) changelog 항목이 있으면
  // 커스텀 모달로 보여주고, 닫으면 최신 버전을 "확인함"으로 기록한다.
  //
  // 진짜 첫 방문자(저장된 값이 아예 없는 경우) 처리 방침: "새로 생긴 기능"
  // 안내는 원래 쓰던 사용자가 다음에 왔을 때 의미가 있는 안내이므로, 한 번도
  // 앱을 써본 적 없는 사용자에게 "계산서함이 새로 생겼어요"라고 보여주는
  // 것은 어색하다(기준이 되는 이전 버전이 없기 때문). 따라서 진짜 신규
  // 방문자에게는 모달을 띄우지 않고 조용히 현재 최신 버전으로 기록만 해서,
  // 다음 업데이트부터 정상적으로 "새로 생긴 기능" 안내를 받게 한다.
  function showChangelogIfNeeded() {
    var latest = getLatestVersion();
    if (!latest) return;

    var lastSeen = getLastSeenVersion();
    if (lastSeen === null) {
      if (!hasExistingAppData()) {
        setLastSeenVersion(latest);
        return;
      }
      // 데이터는 있지만 버전 기록이 없는 기존 사용자 — 이번 업데이트
      // 내용을 아직 못 본 것이므로, 최신 항목 하나만 보여준다(그 이전
      // 이력까지 전부 보여주면 오히려 낯설 수 있다).
      lastSeen = APP_CHANGELOG.length > 1 ? APP_CHANGELOG[1].version : null;
    }
    if (lastSeen === latest) return;

    var lastSeenIndex = -1;
    for (var i = 0; i < APP_CHANGELOG.length; i++) {
      if (APP_CHANGELOG[i].version === lastSeen) { lastSeenIndex = i; break; }
    }
    // 마지막으로 본 버전을 못 찾으면(알 수 없는 값) 최신 항목 하나만 보여준다.
    var unseen = lastSeenIndex === -1 ? [APP_CHANGELOG[0]] : APP_CHANGELOG.slice(0, lastSeenIndex);
    if (!unseen.length) { setLastSeenVersion(latest); return; }

    ensureChangelogStyles();

    var overlay = document.createElement('div');
    overlay.className = 'settlement-changelog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '업데이트 안내');

    var card = document.createElement('div');
    card.className = 'settlement-changelog-card';

    var heading = document.createElement('h2');
    heading.textContent = '새로운 업데이트 소식';
    card.appendChild(heading);

    unseen.forEach(function (entry) {
      var entryEl = document.createElement('div');
      entryEl.className = 'settlement-changelog-entry';

      var title = document.createElement('h3');
      title.textContent = entry.title;
      entryEl.appendChild(title);

      var meta = document.createElement('p');
      meta.className = 'settlement-changelog-meta';
      meta.textContent = 'v' + entry.version + ' · ' + entry.date;
      entryEl.appendChild(meta);

      var list = document.createElement('ul');
      (entry.items || []).forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      entryEl.appendChild(list);

      card.appendChild(entryEl);
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settlement-changelog-close';
    closeBtn.textContent = '확인';
    card.appendChild(closeBtn);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close() {
      setLastSeenVersion(latest);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') close();
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    closeBtn.focus();
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
    getSavedProjectNames: getSavedProjectNames,
    pushProjectToCloud: pushProjectToCloud,
    pullProjectsFromCloud: pullProjectsFromCloud,

    LAST_SEEN_VERSION_KEY: LAST_SEEN_VERSION_KEY,
    APP_CHANGELOG: APP_CHANGELOG,
    getLatestVersion: getLatestVersion,
    getLastSeenVersion: getLastSeenVersion,
    setLastSeenVersion: setLastSeenVersion,
    showChangelogIfNeeded: showChangelogIfNeeded
  };
})();
