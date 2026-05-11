(() => {
  const cfg = window.WATERBOYS_CONFIG || {};
  const API = (cfg.API_BASE_URL || '').replace(/\/$/, '');

  const EXPIRES_KEY = 'waterboys.expiresAt';
  const LEGACY_TOKEN_KEY = 'waterboys.token';

  const $ = (id) => document.getElementById(id);
  const els = {
    header: $('app-header'),
    teamName: $('team-name'),
    loginView: $('login-view'),
    loginForm: $('login-form'),
    password: $('password'),
    loginBtn: $('login-btn'),
    loginError: $('login-error'),
    signoutBtn: $('signout-btn'),
    browserView: $('browser-view'),
    breadcrumb: $('breadcrumb'),
    panes: $('panes'),
    playerOverlay: $('player-overlay'),
    player: $('player'),
    playerTitle: $('player-title'),
    playerClose: $('player-close'),
    status: $('status')
  };

  // <video> needs `crossorigin="use-credentials"` to forward the auth cookie
  // on cross-origin range requests. Setting this on the element instead of
  // the markup keeps existing index.html untouched.
  if (els.player) els.player.crossOrigin = 'use-credentials';

  // Drop any legacy token left behind from the pre-cookie release.
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}

  // Library metadata returned by /api/tree on login.
  let library = null;       // { label, levels: [...] }
  let rootChildren = [];    // top-level tree nodes
  // crumbs[i] is the node selected at depth i. crumbs.length === current depth.
  let crumbs = [];
  let statusTimer = null;

  function showStatus(msg) {
    els.status.textContent = msg;
    els.status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => els.status.classList.remove('show'), 3000);
  }

  function getExpiresAt() {
    const expiresAt = parseInt(localStorage.getItem(EXPIRES_KEY) || '0', 10);
    if (!expiresAt || Date.now() >= expiresAt) return null;
    return expiresAt;
  }

  function setExpiresAt(expiresAt) {
    localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  }

  function clearExpiresAt() {
    localStorage.removeItem(EXPIRES_KEY);
  }

  async function api(pathAndQuery, opts = {}) {
    const res = await fetch(`${API}${pathAndQuery}`, {
      credentials: 'include',
      ...opts,
      headers: { ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      clearExpiresAt();
      showLogin();
      throw new Error('session expired');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `request failed (${res.status})`);
    }
    return res.json();
  }

  function showLogin() {
    els.header.hidden = true;
    els.browserView.hidden = true;
    els.loginView.hidden = false;
    els.password.value = '';
    els.loginError.textContent = '';
    setTimeout(() => els.password.focus(), 50);
  }

  function showBrowser() {
    els.header.hidden = false;
    els.loginView.hidden = true;
    els.browserView.hidden = false;
  }

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!API) {
      els.loginError.textContent = 'Site is not configured (missing API URL).';
      return;
    }
    els.loginError.textContent = '';
    els.loginBtn.disabled = true;
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: els.password.value })
      });
      if (res.status === 429) throw new Error('Too many attempts. Try again in a minute.');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Wrong password.');
      }
      const { expiresAt } = await res.json();
      setExpiresAt(expiresAt);
      showBrowser();
      await loadTree();
    } catch (err) {
      els.loginError.textContent = err.message;
    } finally {
      els.loginBtn.disabled = false;
    }
  });

  els.signoutBtn.addEventListener('click', async () => {
    try {
      await fetch(`${API}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch { /* server unreachable; clear local state anyway */ }
    clearExpiresAt();
    library = null;
    rootChildren = [];
    crumbs = [];
    showLogin();
  });

  async function loadTree() {
    try {
      const data = await api('/api/tree');
      library = { label: data.label || 'WATERBOYS', levels: data.levels || ['Division', 'Season'] };
      rootChildren = data.children || [];
      crumbs = [];
      if (els.teamName) els.teamName.textContent = library.label.toUpperCase();
      renderLevel(0);
    } catch (err) {
      showStatus(`Couldn't load library: ${err.message}`);
    }
  }

  function childrenAtDepth(depth) {
    if (depth === 0) return rootChildren;
    const parent = crumbs[depth - 1];
    return (parent && parent.children) || [];
  }

  function isLeafDepth(depth) {
    return depth >= (library ? library.levels.length : 2);
  }

  function renderBreadcrumb() {
    const parts = [`<button data-depth="0">Home</button>`];
    for (let i = 0; i < crumbs.length; i++) {
      parts.push(`<span class="sep">/</span>`);
      // Last crumb is the current position — non-clickable. Earlier crumbs jump back to that depth.
      if (i === crumbs.length - 1 && isLeafDepth(crumbs.length)) {
        parts.push(`<span>${escapeHtml(crumbs[i].name)}</span>`);
      } else if (i === crumbs.length - 1) {
        parts.push(`<span>${escapeHtml(crumbs[i].name)}</span>`);
      } else {
        parts.push(`<button data-depth="${i + 1}">${escapeHtml(crumbs[i].name)}</button>`);
      }
    }
    els.breadcrumb.innerHTML = parts.join('');
    els.breadcrumb.querySelectorAll('button[data-depth]').forEach(btn => {
      btn.addEventListener('click', () => {
        const depth = parseInt(btn.dataset.depth, 10);
        crumbs = crumbs.slice(0, depth);
        renderLevel(depth);
      });
    });
  }

  function renderLevel(depth) {
    if (!library) return;
    const items = childrenAtDepth(depth);
    const atLeaf = isLeafDepth(depth);
    renderBreadcrumb();

    // Single-pane mode: always show only the pane for `depth`. Avoids horizontal
    // sprawl as level count grows and matches mobile UX.
    const labels = library.levels;
    const heading = atLeaf
      ? 'Videos'
      : (labels[depth] ? `${labels[depth]}${pluralize(labels[depth])}` : 'Items');

    if (atLeaf) {
      els.panes.innerHTML = `
        <section class="pane">
          <h2>${escapeHtml(heading)}</h2>
          <ul class="list video-list" id="dyn-list"></ul>
        </section>`;
      renderVideos(items);
      return;
    }

    els.panes.innerHTML = `
      <section class="pane">
        <h2>${escapeHtml(heading)}</h2>
        <ul class="list" id="dyn-list"></ul>
      </section>`;
    renderFolders(items, depth);
  }

  function pluralize(word) {
    if (!word) return '';
    if (/s$/i.test(word)) return '';
    return 's';
  }

  function renderFolders(items, depth) {
    const list = document.getElementById('dyn-list');
    if (!items || items.length === 0) {
      const nextLabel = library.levels[depth] || 'items';
      list.innerHTML = `<li class="empty">No ${escapeHtml(nextLabel.toLowerCase())}${pluralize(nextLabel.toLowerCase())} found.</li>`;
      return;
    }
    list.innerHTML = '';
    for (const node of items) {
      const li = document.createElement('li');
      li.className = 'folder';
      const childCount = (node.children || []).length;
      const childLabel = isLeafDepth(depth + 1)
        ? `${childCount} video${childCount === 1 ? '' : 's'}`
        : `${childCount} ${(library.levels[depth + 1] || 'item').toLowerCase()}${childCount === 1 ? '' : 's'}`;
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(node.name)}</div>
          <div class="meta">${childLabel}</div>
        </div>
        <span aria-hidden="true">›</span>`;
      li.addEventListener('click', () => {
        crumbs = crumbs.slice(0, depth);
        crumbs.push(node);
        renderLevel(depth + 1);
      });
      list.appendChild(li);
    }
  }

  function renderVideos(videos) {
    const list = document.getElementById('dyn-list');
    if (!videos || videos.length === 0) {
      list.innerHTML = `<li class="empty">No videos here yet.</li>`;
      return;
    }
    list.innerHTML = '';
    for (const v of videos) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(v.name)}</div>
          <div class="meta">${formatBytes(v.size)} · ${formatDate(v.modified)}</div>
        </div>
        <div class="actions">
          <button type="button" class="play">Play</button>
          <button type="button" class="download">Download</button>
        </div>`;
      li.querySelector('.play').addEventListener('click', () => playVideo(v));
      li.querySelector('.download').addEventListener('click', () => downloadVideo(v));
      list.appendChild(li);
    }
  }

  function playVideo(v) {
    if (!getExpiresAt()) { showLogin(); return; }
    els.playerTitle.textContent = v.name;
    els.player.src = `${API}/api/file?path=${encodeURIComponent(v.path)}`;
    els.playerOverlay.hidden = false;
    els.player.play().catch(() => { /* autoplay may be blocked; user can press play */ });
  }

  function closePlayer() {
    els.player.pause();
    els.player.removeAttribute('src');
    els.player.load();
    els.playerOverlay.hidden = true;
  }

  els.playerClose.addEventListener('click', closePlayer);
  els.playerOverlay.addEventListener('click', (e) => {
    if (e.target === els.playerOverlay) closePlayer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.playerOverlay.hidden) closePlayer();
  });

  function downloadVideo(v) {
    if (!getExpiresAt()) { showLogin(); return; }
    const url = `${API}/api/download?path=${encodeURIComponent(v.path)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = v.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatBytes(n) {
    if (!n && n !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
  }

  // Boot
  if (getExpiresAt()) {
    showBrowser();
    loadTree();
  } else {
    showLogin();
  }
})();
