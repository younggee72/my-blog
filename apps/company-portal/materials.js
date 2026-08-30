// materials.js — 업무자료실: Firebase Storage 초기화 + 폴더/업로드/목록/다운로드/삭제 로직 + 렌더링
// (spec.md 8장 참고). ES 모듈로 로드된다 (index.html/portal.js/app.js와는 완전히 분리된 페이지).

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

const ROOMS = ['construction', 'safety'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const KEEP_FILE = '.keep'; // 빈 폴더를 표현하기 위한 0바이트 placeholder 파일명

// 방(room)별로 현재 열려있는 폴더. null이면 "미분류"(폴더 없이 방 최상위에 있는 파일).
const state = {
  construction: { folder: null },
  safety: { folder: null },
};

// ---------- 경로/이름 헬퍼 ----------

function folderStoragePath(room, folder) {
  return folder ? `${room}/${folder}` : room;
}

function buildStoragePath(room, folder, file) {
  const prefixed = `${Date.now()}_${file.name}`;
  return `${folderStoragePath(room, folder)}/${prefixed}`;
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

function roomEls(room) {
  return {
    input: document.getElementById(`upload-input-${room}`),
    uploadBtn: document.getElementById(`upload-btn-${room}`),
    progressList: document.getElementById(`upload-progress-${room}`),
    errorMsg: document.getElementById(`error-msg-${room}`),
    fileList: document.getElementById(`file-list-${room}`),
    emptyMsg: document.getElementById(`empty-msg-${room}`),
  };
}

function folderEls(room) {
  return {
    folderView: document.getElementById(`folder-view-${room}`),
    folderList: document.getElementById(`folder-list-${room}`),
    folderErrorMsg: document.getElementById(`folder-error-msg-${room}`),
    newFolderInput: document.getElementById(`new-folder-input-${room}`),
    newFolderBtn: document.getElementById(`new-folder-btn-${room}`),
    fileView: document.getElementById(`file-view-${room}`),
    folderLabel: document.getElementById(`current-folder-label-${room}`),
    backBtn: document.getElementById(`back-btn-${room}`),
    deleteFolderBtn: document.getElementById(`delete-folder-btn-${room}`),
  };
}

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

function showError(room, message) {
  const { errorMsg } = roomEls(room);
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function clearError(room) {
  const { errorMsg } = roomEls(room);
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}

function showFolderError(room, message) {
  const { folderErrorMsg } = folderEls(room);
  folderErrorMsg.textContent = message;
  folderErrorMsg.hidden = false;
}

function clearFolderError(room) {
  const { folderErrorMsg } = folderEls(room);
  folderErrorMsg.hidden = true;
  folderErrorMsg.textContent = '';
}

// ---------- 업로드 진행률 UI ----------

function progressItemId(room, key) {
  return `upload-progress-${room}-${key}`;
}

function showProgressUI(room, key, fileName, pct) {
  const { progressList } = roomEls(room);
  const id = progressItemId(room, key);
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
    progressList.appendChild(item);
  }
  return item;
}

function updateProgressUI(room, key, fileName, pct) {
  const item = showProgressUI(room, key, fileName, pct);
  const pctSpan = item.querySelector('.upload-progress-pct');
  const fill = item.querySelector('.upload-progress-fill');
  if (pctSpan) pctSpan.textContent = `${pct}%`;
  if (fill) fill.style.width = `${pct}%`;
}

function hideProgressUI(room, key) {
  const id = progressItemId(room, key);
  const item = document.getElementById(id);
  if (item) item.remove();
}

// ---------- 파일 크기 검증 ----------

function validateFileSize(room, file) {
  if (file.size > MAX_FILE_SIZE) {
    showError(room, `"${file.name}" 파일이 200MB를 초과합니다. (${formatBytes(file.size)}) 200MB 이하 파일만 업로드할 수 있습니다.`);
    return false;
  }
  return true;
}

// ---------- 폴더 ----------

async function refreshFolderList(room) {
  const { folderList } = folderEls(room);
  folderList.innerHTML = '';
  try {
    const roomRef = ref(storage, room);
    const result = await listAll(roomRef);
    const folderNames = result.prefixes.map((p) => p.name);
    const hasUnsortedFiles = result.items.some((item) => item.name !== KEEP_FILE);

    const entries = [];
    if (hasUnsortedFiles) entries.push({ folder: null, label: '📄 미분류 파일' });
    folderNames.forEach((name) => entries.push({ folder: name, label: `📁 ${name}` }));

    if (entries.length === 0) {
      folderList.appendChild(el('p', { className: 'empty-msg', text: '아직 폴더나 파일이 없습니다. 위에서 폴더를 먼저 만들어보세요.' }));
      return;
    }

    entries.forEach(({ folder, label }) => {
      const card = el('button', { className: 'folder-card', text: label, attrs: { type: 'button' } });
      card.addEventListener('click', () => showFileView(room, folder));
      folderList.appendChild(card);
    });
  } catch (err) {
    console.warn(`[materials] ${room} 폴더 목록 조회 실패`, err);
    showFolderError(room, `폴더 목록을 불러오지 못했습니다: ${err.message}`);
  }
}

async function createFolder(room, rawName) {
  const name = rawName.trim();
  clearFolderError(room);
  if (!name) {
    showFolderError(room, '폴더 이름을 입력해주세요.');
    return;
  }
  if (name.includes('/')) {
    showFolderError(room, '폴더 이름에 "/"는 사용할 수 없습니다.');
    return;
  }
  try {
    const keepRef = ref(storage, `${room}/${name}/${KEEP_FILE}`);
    await uploadBytes(keepRef, new Uint8Array());
    folderEls(room).newFolderInput.value = '';
    refreshFolderList(room);
  } catch (err) {
    console.warn(`[materials] ${room} 폴더 생성 실패`, err);
    showFolderError(room, `폴더 생성 실패: ${err.message}`);
  }
}

async function deleteFolder(room) {
  const folder = state[room].folder;
  if (!folder) return;
  const ok = confirm(`"${folder}" 폴더와 그 안의 모든 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;
  try {
    const folderRef = ref(storage, folderStoragePath(room, folder));
    const result = await listAll(folderRef);
    await Promise.all(result.items.map((itemRef) => deleteObject(itemRef)));
    showFolderListView(room);
  } catch (err) {
    console.warn(`[materials] ${room} 폴더 삭제 실패`, err);
    showError(room, `폴더 삭제 실패: ${err.message}`);
  }
}

// ---------- 화면 전환(폴더 목록 ↔ 폴더 안 파일) ----------

function showFolderListView(room) {
  const { folderView, fileView } = folderEls(room);
  folderView.hidden = false;
  fileView.hidden = true;
  state[room].folder = null;
  refreshFolderList(room);
}

function showFileView(room, folder) {
  state[room].folder = folder;
  const { folderView, fileView, folderLabel, deleteFolderBtn } = folderEls(room);
  folderView.hidden = true;
  fileView.hidden = false;
  folderLabel.textContent = folder ? `📁 ${folder}` : '📄 미분류 파일';
  deleteFolderBtn.hidden = !folder;
  clearError(room);
  refreshFileList(room);
}

// ---------- 업로드 ----------

function uploadFile(room, file) {
  clearError(room);
  if (!validateFileSize(room, file)) return;

  const folder = state[room].folder;
  const path = buildStoragePath(room, folder, file);
  const fileRef = ref(storage, path);
  const task = uploadBytesResumable(fileRef, file);
  const key = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  showProgressUI(room, key, file.name, 0);

  task.on('state_changed',
    (snapshot) => {
      const pct = snapshot.totalBytes > 0
        ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        : 0;
      updateProgressUI(room, key, file.name, pct);
    },
    (error) => {
      hideProgressUI(room, key);
      showError(room, `업로드 실패: ${error.message}`);
    },
    () => {
      hideProgressUI(room, key);
      refreshFileList(room);
    }
  );
}

// ---------- 목록 조회/렌더링 ----------

async function refreshFileList(room) {
  const { fileList, emptyMsg } = roomEls(room);
  const folder = state[room].folder;
  try {
    const folderRef = ref(storage, folderStoragePath(room, folder));
    const result = await listAll(folderRef);

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
    renderFileList(room, validItems);
  } catch (err) {
    console.warn(`[materials] ${room} 목록 조회 실패`, err);
    showError(room, `파일 목록을 불러오지 못했습니다: ${err.message}`);
    fileList.innerHTML = '';
    emptyMsg.hidden = false;
  }
}

function renderFileList(room, items) {
  const { fileList, emptyMsg } = roomEls(room);
  fileList.innerHTML = '';

  if (items.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

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
    deleteBtn.addEventListener('click', () => deleteFile(room, item));
    deleteCell.appendChild(deleteBtn);
    row.appendChild(deleteCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
  fileList.appendChild(wrap);
}

// ---------- 다운로드/삭제 ----------

function downloadFile(item) {
  window.open(item.url, '_blank');
}

async function deleteFile(room, item) {
  const ok = confirm(`"${item.name}" 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;
  try {
    const fileRef = ref(storage, item.path);
    await deleteObject(fileRef);
    await refreshFileList(room);
  } catch (err) {
    console.warn(`[materials] 삭제 실패(${item.path})`, err);
    showError(room, `삭제 실패: ${err.message}`);
  }
}

// ---------- 업로드 버튼/입력 바인딩 ----------

function bindUpload(room) {
  const { input, uploadBtn } = roomEls(room);
  uploadBtn.addEventListener('click', () => {
    const file = input.files && input.files[0];
    if (!file) {
      showError(room, '업로드할 파일을 선택해주세요.');
      return;
    }
    uploadFile(room, file);
    input.value = '';
  });
}

// ---------- 폴더 버튼/입력 바인딩 ----------

function bindFolderControls(room) {
  const { newFolderInput, newFolderBtn, backBtn, deleteFolderBtn } = folderEls(room);

  newFolderBtn.addEventListener('click', () => createFolder(room, newFolderInput.value));
  newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createFolder(room, newFolderInput.value);
  });

  backBtn.addEventListener('click', () => showFolderListView(room));
  deleteFolderBtn.addEventListener('click', () => deleteFolder(room));
}

// ---------- 탭 전환 ----------

function bindTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetRoom = btn.dataset.room;
      tabBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      ROOMS.forEach((room) => {
        const panel = document.getElementById(`room-${room}`);
        if (panel) panel.hidden = room !== targetRoom;
      });
    });
  });
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

function init() {
  initTheme();
  initGuideBox();
  bindTabs();
  ROOMS.forEach((room) => {
    bindUpload(room);
    bindFolderControls(room);
    refreshFolderList(room);
  });
}

init();
