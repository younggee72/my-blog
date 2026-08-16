(async function () {
  const titleEl = document.getElementById('post-title');
  const dateEl = document.getElementById('post-date');
  const bodyEl = document.getElementById('post-body');
  if (!bodyEl) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('post');

  if (window.location.protocol === 'file:') {
    bodyEl.innerHTML =
      '<p class="empty">이 페이지를 <code>file://</code>로 직접 열면 브라우저 보안 정책 때문에 글을 불러올 수 없습니다.</p>' +
      '<p class="empty">터미널에서 <code>python -m http.server</code>를 실행한 뒤 <code>http://localhost:8000</code>으로 접속해 주세요.</p>';
    return;
  }

  if (!slug) {
    bodyEl.innerHTML = '<p class="empty">글을 찾을 수 없습니다.</p>';
    return;
  }

  try {
    const res = await fetch('posts/' + slug + '.md', { cache: 'no-store' });
    if (!res.ok) throw new Error('not found');
    const raw = await res.text();
    const { meta, body } = MD.parseFrontmatter(raw);

    document.title = (meta.title || slug) + ' - My Blog';
    if (titleEl) titleEl.textContent = meta.title || slug;
    if (dateEl) dateEl.textContent = meta.date || '';
    bodyEl.innerHTML = MD.renderMarkdown(body);
  } catch (err) {
    bodyEl.innerHTML = '<p class="empty">글을 찾을 수 없습니다.</p>';
    console.error(err);
  }
})();
