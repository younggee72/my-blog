// materials.js — 업무자료실: Firebase Storage 초기화 + 동적 탭(자료실) + 탭 안 윈도우 탐색기 스타일
// 무한 하위 폴더 + 업로드/목록/다운로드/삭제 로직 + 렌더링 (spec.md 8장 참고).
// ES 모듈로 로드된다 (index.html/portal.js/app.js와는 완전히 분리된 페이지).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage, ref, uploadBytesResumable, uploadBytes, listAll,
  getMetadata, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdyXmaN_rgxG_eCFA8jnuzvQabL8thLFk",
  authDomain: "jicheon-construction.firebaseapp.com",
  projectId: "jicheon-construction",
  storageBucket: "jicheon-construction.firebasestorage.app",
  messagingSenderId: "79554524630",
  appId: "1:79554524630:web:67a2588607f85984c82077",
  measurementId: "G-H7P1VFC43Q"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const KEEP_FILE = '.keep'; // 빈 폴더/자료실을 표현하기 위한 0바이트 placeholder 파일명
// 기존부터 있던 최상위 자료실 2개는 한글 라벨로 표시(그 외 새로 만든 자료실은 입력한 이름 그대로 표시)
const ROOM_LABELS = { construction: '공사자료', safety: '안전자료' };

let rooms = [];        // 최상위 자료실(탭) 이름 목록
let activeRoom = null;  // 현재 선택된 자료실
let subPath = [];       // activeRoom 안에서 탐색 중인 하위 경로

// ---------- 경로/이름 헬퍼 ----------

function roomLabel(name) {
  return ROOM_LABELS[name] || name;
}

function currentRef() {
  const path = activeRoom ? [activeRoom, ...subPath] : [];
  return path.length ? ref(storage, path.join('/')) : ref(storage);
}

function displayName(storagePath) {
  const filename = storagePath.split('/').pop();
  return filename.replace(/^\d+_/, '');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString) {
  if (!isoString) return '알 수 없음';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// ---------- DOM 참조 ----------

const els = {
  tabs: document.getElementById('tabs'),
  breadcrumb: document.getElementById('breadcrumb'),
  newFolderInput: document.getElementById('new-folder-input'),
  newFolderBtn: document.getElementById('new-folder-btn'),
  deleteFolderBtn: document.getElementById('delete-folder-btn'),
  folderErrorMsg: document.getElementById('folder-error-msg'),
  folderList: document.getElementById('folder-list'),
  input: document.getElementById('upload-input'),
  uploadBtn: document.getElementById('upload-btn'),
  uploadCancelBtn: document.getElementById('upload-cancel-btn'),
  progressList: document.getElementById('upload-progress'),
  errorMsg: document.getElementById('error-msg'),
  fileList: document.getElementById('file-list'),
  emptyMsg: document.getElementById('empty-msg'),
};

// XSS 방지: 파일명/폴더명 등 사용자 입력값은 textContent로만 DOM에 넣는다.
function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
    }
  }
  return node;
}

function showError(message) {
  els.errorMsg.textContent = message;
  els.errorMsg.hidden = false;
}

function clearError() {
  els.errorMsg.hidden = true;
  els.errorMsg.textContent = '';
}

function showFolderError(message) {
  els.folderErrorMsg.textContent = message;
  els.folderErrorMsg.hidden = false;
}

function clearFolderError() {
  els.folderErrorMsg.hidden = true;
  els.folderErrorMsg.textContent = '';
}

// ---------- 업로드 진행률 UI ----------

function progressItemId(key) {
  return `upload-progress-${key}`;
}

function showProgressUI(key, fileName, pct) {
  const id = progressItemId(key);
  let item = document.getElementById(id);
  if (!item) {
    item = el('div', { className: 'upload-progress-item', attrs: { id } });
    const nameRow = el('div', { className: 'upload-progress-name' });
    const nameSpan = el('span', { text: fileName });
    const pctSpan = el('span', { className: 'upload-progress-pct', text: `${pct}%` });
    nameRow.appendChild(nameSpan);
    nameRow.appendChild(pctSpan);
    const track = el('div', { className: 'upload-progress-track' });
    const fill = el('div', { className: 'upload-progress-fill' });
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    item.appendChild(nameRow);
    item.appendChild(track);
    els.progressList.appendChild(item);
  }
  return item;
}

function updateProgressUI(key, fileName, pct) {
  const item = showProgressUI(key, fileName, pct);
  const pctSpan = item.querySelector('.upload-progress-pct');
  const fill = item.querySelector('.upload-progress-fill');
  if (pctSpan) pctSpan.textContent = `${pct}%`;
  if (fill) fill.style.width = `${pct}%`;
}

function hideProgressUI(key) {
  const item = document.getElementById(progressItemId(key));
  if (item) item.remove();
}

// ---------- 파일 크기 검증 ----------

function validateFileSize(file) {
  if (file.size > MAX_FILE_SIZE) {
    showError(`"${file.name}" 파일이 200MB를 초과합니다. (${formatBytes(file.size)}) 200MB 이하 파일만 업로드할 수 있습니다.`);
    return false;
  }
  return true;
}

// ---------- 자료실(탭) ----------

async function loadRooms() {
  const result = await listAll(ref(storage));
  rooms = result.prefixes.map((p) => p.name);
  if (!activeRoom || !rooms.includes(activeRoom)) {
    activeRoom = rooms[0] || null;
    subPath = [];
  }
  renderTabs();
}

function renderTabs() {
  els.tabs.innerHTML = '';
  rooms.forEach((room, idx) => {
    const btn = el('button', {
      className: 'tab-btn' + (room === activeRoom ? ' active' : ''),
      text: `${idx + 1}. ${roomLabel(room)}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(room === activeRoom) }
    });
    btn.addEventListener('click', () => selectRoom(room));
    els.tabs.appendChild(btn);
  });

  const addBtn = el('button', { className: 'tab-btn tab-add-btn', text: '+ 새 자료실', attrs: { type: 'button' } });
  addBtn.addEventListener('click', addRoom);
  els.tabs.appendChild(addBtn);
}

function selectRoom(room) {
  activeRoom = room;
  subPath = [];
  renderTabs();
  refreshExplorer();
}

async function addRoom() {
  const rawName = window.prompt('새 자료실(탭) 이름을 입력하세요 (예: 품질자료)');
  if (rawName === null) return;
  const name = rawName.trim();
  if (!name) return;
  if (name.includes('/')) {
    window.alert('이름에 "/"는 사용할 수 없습니다.');
    return;
  }
  try {
    const keepRef = ref(storage, `${name}/${KEEP_FILE}`);
    await uploadBytes(keepRef, new Uint8Array());
    await loadRooms();
    selectRoom(name);
  } catch (err) {
    console.warn('[materials] 자료실 생성 실패', err);
    window.alert(`자료실 생성 실패: ${err.message}`);
  }
}

// ---------- 탐색(경로 이동) ----------

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = '';
  if (!activeRoom) return;

  const homeBtn = el('button', {
    className: subPath.length ? 'breadcrumb-link' : 'breadcrumb-current',
    text: `🏠 ${roomLabel(activeRoom)}`,
    attrs: { type: 'button' }
  });
  if (subPath.length) homeBtn.addEventListener('click', () => goToDepth(0));
  els.breadcrumb.appendChild(homeBtn);

  subPath.forEach((segment, idx) => {
    els.breadcrumb.appendChild(el('span', { className: 'breadcrumb-sep', text: '›' }));
    const isLast = idx === subPath.length - 1;
    const segBtn = el('button', {
      className: isLast ? 'breadcrumb-current' : 'breadcrumb-link',
      text: segment,
      attrs: { type: 'button' }
    });
    if (!isLast) segBtn.addEventListener('click', () => goToDepth(idx + 1));
    els.breadcrumb.appendChild(segBtn);
  });
}

function goToDepth(depth) {
  subPath = subPath.slice(0, depth);
  refreshExplorer();
}

function enterFolder(name) {
  subPath.push(name);
  refreshExplorer();
}

// ---------- 폴더 만들기/삭제 ----------

async function createFolder(rawName) {
  const name = rawName.trim();
  clearFolderError();
  if (!name) {
    showFolderError('폴더 이름을 입력해주세요.');
    return;
  }
  if (name.includes('/')) {
    showFolderError('폴더 이름에 "/"는 사용할 수 없습니다.');
    return;
  }
  try {
    const keepRef = ref(currentRef(), `${name}/${KEEP_FILE}`);
    await uploadBytes(keepRef, new Uint8Array());
    els.newFolderInput.value = '';
    refreshExplorer();
  } catch (err) {
    console.warn('[materials] 폴더 생성 실패', err);
    showFolderError(`폴더 생성 실패: ${err.message}`);
  }
}

// 폴더 하나를 그 안의 모든 하위 폴더/파일까지 재귀적으로 삭제한다.
async function deleteObjectsRecursive(folderRef) {
  const result = await listAll(folderRef);
  await Promise.all(result.items.map((itemRef) => deleteObject(itemRef)));
  await Promise.all(result.prefixes.map((prefixRef) => deleteObjectsRecursive(prefixRef)));
}

async function deleteFolder() {
  if (subPath.length === 0) return;
  const name = subPath[subPath.length - 1];
  const ok = confirm(`"${name}" 폴더와 그 안의 모든 하위 폴더·파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;
  try {
    await deleteObjectsRecursive(currentRef());
    goToDepth(subPath.length - 1);
  } catch (err) {
    console.warn('[materials] 폴더 삭제 실패', err);
    showError(`폴더 삭제 실패: ${err.message}`);
  }
}

// ---------- 업로드 ----------

function uploadFile(file) {
  clearError();
  if (!validateFileSize(file)) return;

  const prefixed = `${Date.now()}_${file.name}`;
  const fileRef = ref(currentRef(), prefixed);
  const task = uploadBytesResumable(fileRef, file);
  const key = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  showProgressUI(key, file.name, 0);

  task.on('state_changed',
    (snapshot) => {
      const pct = snapshot.totalBytes > 0
        ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        : 0;
      updateProgressUI(key, file.name, pct);
    },
    (error) => {
      hideProgressUI(key);
      showError(`업로드 실패: ${error.message}`);
    },
    () => {
      hideProgressUI(key);
      refreshExplorer();
    }
  );
}

// ---------- 현재 경로 조회/렌더링(하위 폴더 + 파일) ----------

async function refreshExplorer() {
  clearError();
  clearFolderError();
  renderBreadcrumb();
  els.deleteFolderBtn.hidden = subPath.length === 0;

  if (!activeRoom) {
    els.folderList.innerHTML = '';
    els.fileList.innerHTML = '';
    els.emptyMsg.hidden = false;
    return;
  }

  try {
    const result = await listAll(currentRef());

    // 하위 폴더 렌더링
    els.folderList.innerHTML = '';
    result.prefixes.forEach((prefixRef) => {
      const card = el('button', { className: 'folder-card', text: `📁 ${prefixRef.name}`, attrs: { type: 'button' } });
      card.addEventListener('click', () => enterFolder(prefixRef.name));
      els.folderList.appendChild(card);
    });

    // 현재 경로에 있는 파일 렌더링
    const items = await Promise.all(result.items
      .filter((itemRef) => itemRef.name !== KEEP_FILE)
      .map(async (itemRef) => {
        try {
          const [meta, url] = await Promise.all([
            getMetadata(itemRef),
            getDownloadURL(itemRef)
          ]);
          return {
            path: itemRef.fullPath,
            name: displayName(itemRef.name),
            size: meta.size,
            uploadedAt: meta.timeCreated,
            url
          };
        } catch (err) {
          console.warn(`[materials] 파일 메타데이터 조회 실패(${itemRef.fullPath})`, err);
          return null;
        }
      }));

    const validItems = items.filter((it) => it !== null);
    validItems.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    renderFileList(validItems);

    els.emptyMsg.hidden = !(result.prefixes.length === 0 && validItems.length === 0);
  } catch (err) {
    console.warn('[materials] 목록 조회 실패', err);
    showError(`목록을 불러오지 못했습니다: ${err.message}`);
    els.folderList.innerHTML = '';
    els.fileList.innerHTML = '';
    els.emptyMsg.hidden = false;
  }
}

function renderFileList(items) {
  els.fileList.innerHTML = '';
  if (items.length === 0) return;

  const wrap = el('div', { className: 'file-table-wrap' });
  const table = el('table', { className: 'file-table' });

  const thead = el('thead');
  const headRow = el('tr');
  ['번호', '제목', '파일크기', '업로드일시', '다운로드', '삭제'].forEach((text) => {
    headRow.appendChild(el('th', { text }));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  items.forEach((item, index) => {
    const row = el('tr');
    row.appendChild(el('td', { className: 'file-table-num', text: String(index + 1) }));
    row.appendChild(el('td', { className: 'file-table-name', text: item.name }));
    row.appendChild(el('td', { className: 'file-table-size', text: formatBytes(item.size) }));
    row.appendChild(el('td', { className: 'file-table-date', text: formatDate(item.uploadedAt) }));

    const downloadCell = el('td', { className: 'file-table-action' });
    const downloadBtn = el('button', { className: 'btn btn-secondary', text: '다운로드', attrs: { type: 'button' } });
    downloadBtn.addEventListener('click', () => downloadFile(item));
    downloadCell.appendChild(downloadBtn);
    row.appendChild(downloadCell);

    const deleteCell = el('td', { className: 'file-table-action' });
    const deleteBtn = el('button', { className: 'btn btn-danger', text: '삭제', attrs: { type: 'button' } });
    deleteBtn.addEventListener('click', () => deleteFile(item));
    deleteCell.appendChild(deleteBtn);
    row.appendChild(deleteCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
  els.fileList.appendChild(wrap);
}

// ---------- 다운로드/삭제 ----------

function downloadFile(item) {
  window.open(item.url, '_blank');
}

async function deleteFile(item) {
  const ok = confirm(`"${item.name}" 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;
  try {
    await deleteObject(ref(storage, item.path));
    await refreshExplorer();
  } catch (err) {
    console.warn(`[materials] 삭제 실패(${item.path})`, err);
    showError(`삭제 실패: ${err.message}`);
  }
}

// ---------- 버튼/입력 바인딩 ----------

function bindControls() {
  els.uploadBtn.addEventListener('click', () => {
    const file = els.input.files && els.input.files[0];
    if (!file) {
      showError('업로드할 파일을 선택해주세요.');
      return;
    }
    uploadFile(file);
    els.input.value = '';
    els.uploadCancelBtn.hidden = true;
  });

  els.input.addEventListener('change', () => {
    const hasFile = !!(els.input.files && els.input.files[0]);
    els.uploadCancelBtn.hidden = !hasFile;
  });

  els.uploadCancelBtn.addEventListener('click', () => {
    els.input.value = '';
    els.uploadCancelBtn.hidden = true;
  });

  els.newFolderBtn.addEventListener('click', () => createFolder(els.newFolderInput.value));
  els.newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createFolder(els.newFolderInput.value);
  });

  els.deleteFolderBtn.addEventListener('click', () => deleteFolder());
}

// ---------- 다크모드(다른 앱과 동일 패턴) ----------

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
  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.textContent = getEffectiveTheme() === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved);
  themeToggle.addEventListener('click', () => {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// ---------- 사용법 안내 박스(다른 앱과 동일 패턴) ----------

const GUIDE_KEY = 'company-portal-materials-guide-collapsed';

function initGuideBox() {
  const guideBox = document.getElementById('guide-box');
  const guideToggle = document.getElementById('guide-toggle');
  const guideContent = document.getElementById('guide-content');
  const guideToggleLabel = document.getElementById('guide-toggle-label');

  function setCollapsed(collapsed) {
    guideBox.classList.toggle('collapsed', collapsed);
    guideContent.hidden = collapsed;
    guideToggle.setAttribute('aria-expanded', String(!collapsed));
    guideToggleLabel.textContent = collapsed ? '사용법 안내 다시 보기' : '사용법 안내 닫기';
  }

  const collapsed = localStorage.getItem(GUIDE_KEY) === 'true';
  setCollapsed(collapsed);
  guideToggle.addEventListener('click', () => {
    const isCollapsed = guideBox.classList.contains('collapsed');
    setCollapsed(!isCollapsed);
    localStorage.setItem(GUIDE_KEY, String(!isCollapsed));
  });
}

// ---------- 초기화 ----------

async function init() {
  initTheme();
  initGuideBox();
  bindControls();
  await loadRooms();
  await refreshExplorer();
}

init();
