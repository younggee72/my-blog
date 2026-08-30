// auth.js — 현장정산서 도구 전체를 잠그는 클라이언트 수준 비밀번호 가림막.
// 돈이 관계된 자료라 회사포털(7200)과는 별도의 비밀번호로 한 번 더 잠근다.
// 평문 비밀번호는 코드 어디에도 저장하지 않는다. sha256("civil69100*")의 16진수 해시값만 상수로 둔다.
// index.html/invoices.html 양쪽에서 다른 스크립트(shared-utils.js 등)보다 먼저 로드된다.

const PASSWORD_HASH = '7cadc94cdaf99c4c63d5bf16f702b65dc33e82591006a5377c760c34f600e294';
const UNLOCK_SESSION_KEY = 'settlement-unlocked';

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPassword(input) {
  const hash = await sha256Hex(input);
  return hash === PASSWORD_HASH;
}

function isUnlocked() {
  return sessionStorage.getItem(UNLOCK_SESSION_KEY) === 'true';
}

function setUnlocked() {
  sessionStorage.setItem(UNLOCK_SESSION_KEY, 'true');
}

// body 바로 아래의 실제 화면 요소(header/nav/main)만 보이기/숨기기 대상으로 삼는다.
function contentEls() {
  return document.querySelectorAll('body > header, body > nav, body > main');
}

function revealContent() {
  contentEls().forEach((elmt) => { elmt.hidden = false; });
  const overlay = document.getElementById('auth-gate-overlay');
  if (overlay) overlay.remove();
}

function buildGateOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-gate-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
      <h2 id="auth-gate-title">🔒 현장정산서 도구</h2>
      <p class="form-hint">돈이 관계된 자료라 별도 비밀번호로 잠겨 있습니다.</p>
      <form id="auth-gate-form" novalidate>
        <div class="field">
          <label class="field-label" for="auth-gate-input">비밀번호</label>
          <input id="auth-gate-input" type="password" autocomplete="off">
          <p id="auth-gate-error" class="error-msg" hidden>비밀번호가 올바르지 않습니다.</p>
        </div>
        <div class="auth-gate-actions">
          <button type="submit" id="auth-gate-submit" class="btn-primary">확인</button>
          <a href="../company-portal/index.html" class="btn-secondary auth-gate-back">← 포털로 돌아가기</a>
        </div>
        <p class="unlock-hint">이 잠금은 완전한 보안 장치가 아닙니다. 브라우저 개발자도구 등으로 우회될 수 있는 클라이언트 수준의 가림막입니다.</p>
      </form>
    </div>
  `;
  return overlay;
}

function initAuthGate() {
  if (isUnlocked()) {
    revealContent();
    return;
  }

  const overlay = buildGateOverlay();
  document.body.appendChild(overlay);

  const form = document.getElementById('auth-gate-form');
  const input = document.getElementById('auth-gate-input');
  const errorMsg = document.getElementById('auth-gate-error');
  const submitBtn = document.getElementById('auth-gate-submit');

  input.focus();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorMsg.hidden = true;
    submitBtn.disabled = true;

    verifyPassword(input.value)
      .then((ok) => {
        if (ok) {
          setUnlocked();
          revealContent();
        } else {
          errorMsg.hidden = false;
          input.focus();
          input.select();
        }
      })
      .catch((err) => {
        console.warn('[settlement] 비밀번호 확인 중 오류가 발생했습니다.', err);
        errorMsg.hidden = false;
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });
}

initAuthGate();
