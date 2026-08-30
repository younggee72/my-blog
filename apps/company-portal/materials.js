// materials.js — 업무자료실: Firebase Storage 초기화 + 업로드/목록/다운로드/삭제 로직 + 렌더링
// (spec.md 8장 참고). ES 모듈로 로드된다 (index.html/portal.js/app.js와는 완전히 분리된 페이지).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage, ref, uploadBytesResumable, listAll,
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
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// ---------- 경로/이름 헬퍼 ----------

function buildStoragePath(room, file) {
  const prefixed = `${Date.now()}_${file.name}`;
  return `${room}/${prefixed}`;
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

// XSS 방지: 파일명 등 사용자 입력값은 textContent로만 DOM에 넣는다.
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
    showError(room, `"${file.name}" 파일이 20MB를 초과합니다. (${formatBytes(file.size)}) 20MB 이하 파일만 업로드할 수 있습니다.`);
    return false;
  }
  return true;
}

// ---------- 업로드 ----------

function uploadFile(room, file) {
  clearError(room);
  if (!validateFileSize(room, file)) return;

  const path = buildStoragePath(room, file);
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
  try {
    const folderRef = ref(storage, room);
    const result = await listAll(folderRef);

    const items = await Promise.all(result.items.map(async (itemRef) => {
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

  items.forEach((item) => {
    const card = el('div', { className: 'file-card' });

    const nameEl = el('p', { className: 'file-card-name', text: item.name });
    const uploadedDate = item.uploadedAt ? new Date(item.uploadedAt).toLocaleString('ko-KR') : '알 수 없음';
    const metaEl = el('p', { className: 'file-card-meta', text: `${formatBytes(item.size)} · ${uploadedDate}` });

    const actions = el('div', { className: 'file-card-actions' });
    const downloadBtn = el('button', { className: 'btn btn-secondary', text: '다운로드', attrs: { type: 'button' } });
    downloadBtn.addEventListener('click', () => downloadFile(item));
    const deleteBtn = el('button', { className: 'btn btn-danger', text: '삭제', attrs: { type: 'button' } });
    deleteBtn.addEventListener('click', () => deleteFile(room, item));

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(nameEl);
    card.appendChild(metaEl);
    card.appendChild(actions);
    fileList.appendChild(card);
  });
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
    refreshFileList(room);
  });
}

init();
