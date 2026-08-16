(function () {
  function getPreferredGlow() {
    const stored = localStorage.getItem('glow');
    return stored === 'off' ? 'off' : 'on';
  }

  function updateToggleIcon(glow) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = glow === 'off' ? '💤' : '⚡';
  }

  function applyGlow(glow) {
    document.documentElement.classList.toggle('no-glow', glow === 'off');
    updateToggleIcon(glow);
  }

  function toggleGlow() {
    const current = document.documentElement.classList.contains('no-glow') ? 'off' : 'on';
    const next = current === 'off' ? 'on' : 'off';
    localStorage.setItem('glow', next);
    applyGlow(next);
  }

  applyGlow(getPreferredGlow());

  document.addEventListener('DOMContentLoaded', function () {
    updateToggleIcon(getPreferredGlow());
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleGlow);
  });
})();
