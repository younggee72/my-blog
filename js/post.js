(async function () {
  const titleEl = document.getElementById('post-title');
  const dateEl = document.getElementById('post-date');
  const bodyEl = document.getElementById('post-body');
  if (!bodyEl) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('post');

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
