(async function () {
  const listEl = document.getElementById('post-list');
  if (!listEl) return;

  try {
    const manifestRes = await fetch('posts/manifest.json', { cache: 'no-store' });
    if (!manifestRes.ok) throw new Error('manifest fetch failed');
    const files = await manifestRes.json();

    const posts = await Promise.all(
      files.map(async (file) => {
        const res = await fetch('posts/' + file, { cache: 'no-store' });
        const raw = await res.text();
        const { meta } = MD.parseFrontmatter(raw);
        const slug = file.replace(/\.md$/, '');
        return {
          slug,
          title: meta.title || slug,
          date: meta.date || '',
        };
      })
    );

    posts.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

    if (posts.length === 0) {
      listEl.innerHTML = '<p class="empty">아직 작성된 글이 없습니다.</p>';
      return;
    }

    listEl.innerHTML = posts
      .map(
        (p) =>
          '<article class="post-card">' +
          '<h2><a href="post.html?post=' + encodeURIComponent(p.slug) + '">' + MD.escapeHtml(p.title) + '</a></h2>' +
          (p.date ? '<time>' + MD.escapeHtml(p.date) + '</time>' : '') +
          '</article>'
      )
      .join('');
  } catch (err) {
    listEl.innerHTML = '<p class="empty">글 목록을 불러오지 못했습니다.</p>';
    console.error(err);
  }
})();
