(() => {
  const cfg = window.WATERBOYS_CONFIG || {};
  const API = (cfg.API_BASE_URL || '').replace(/\/$/, '');

  const EXPIRES_KEY = 'waterboys.expiresAt';
  const LEGACY_TOKEN_KEY = 'waterboys.token';

  const $ = (id) => document.getElementById(id);
  const els = {
    header: $('app-header'),
    loginView: $('login-view'),
    loginForm: $('login-form'),
    password: $('password'),
    loginBtn: $('login-btn'),
    loginError: $('login-error'),
    signoutBtn: $('signout-btn'),
    browserView: $('browser-view'),
    breadcrumb: $('breadcrumb'),
    paneDivisions: $('pane-divisions'),
    paneSeasons: $('pane-seasons'),
    paneVideos: $('pane-videos'),
    listDivisions: $('list-divisions'),
    listSeasons: $('list-seasons'),
    listVideos: $('list-videos'),
    seasonsTitle: $('seasons-title'),
    videosTitle: $('videos-title'),
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

  let tree = null;
  let currentDivision = null;
  let currentSeason = null;
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
    tree = null;
    currentDivision = null;
    currentSeason = null;
    showLogin();
  });

  async function loadTree() {
    try {
      const data = await api('/api/tree');
      tree = data.children || [];
      renderDivisions();
    } catch (err) {
      showStatus(`Couldn't load library: ${err.message}`);
    }
  }

  function renderBreadcrumb() {
    const parts = [];
    parts.push(`<button data-nav="root">Home</button>`);
    if (currentDivision) {
      parts.push(`<span class="sep">/</span>`);
      parts.push(`<button data-nav="division">${escapeHtml(currentDivision.name)}</button>`);
    }
    if (currentSeason) {
      parts.push(`<span class="sep">/</span>`);
      parts.push(`<span>${escapeHtml(currentSeason.name)}</span>`);
    }
    els.breadcrumb.innerHTML = parts.join('');
    els.breadcrumb.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.nav;
        if (target === 'root') {
          currentDivision = null;
          currentSeason = null;
          renderDivisions();
        } else if (target === 'division') {
          currentSeason = null;
          renderSeasons();
        }
      });
    });
  }

  function renderDivisions() {
    currentDivision = null;
    currentSeason = null;
    els.paneDivisions.hidden = false;
    els.paneSeasons.hidden = true;
    els.paneVideos.hidden = true;
    renderBreadcrumb();

    if (!tree || tree.length === 0) {
      els.listDivisions.innerHTML = `<li class="empty">No divisions found.</li>`;
      return;
    }

    els.listDivisions.innerHTML = '';
    for (const div of tree) {
      const li = document.createElement('li');
      li.className = 'folder';
      const seasonCount = (div.children || []).length;
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(div.name)}</div>
          <div class="meta">${seasonCount} season${seasonCount === 1 ? '' : 's'}</div>
        </div>
        <span aria-hidden="true">›</span>`;
      li.addEventListener('click', () => {
        currentDivision = div;
        renderSeasons();
      });
      els.listDivisions.appendChild(li);
    }
  }

  function renderSeasons() {
    if (!currentDivision) return renderDivisions();
    currentSeason = null;
    els.paneDivisions.hidden = true;
    els.paneSeasons.hidden = false;
    els.paneVideos.hidden = true;
    els.seasonsTitle.textContent = `${currentDivision.name} — Seasons`;
    renderBreadcrumb();

    const seasons = currentDivision.children || [];
    if (seasons.length === 0) {
      els.listSeasons.innerHTML = `<li class="empty">No seasons in this division yet.</li>`;
      return;
    }

    els.listSeasons.innerHTML = '';
    for (const season of seasons) {
      const li = document.createElement('li');
      li.className = 'folder';
      const count = (season.children || []).length;
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(season.name)}</div>
          <div class="meta">${count} video${count === 1 ? '' : 's'}</div>
        </div>
        <span aria-hidden="true">›</span>`;
      li.addEventListener('click', () => {
        currentSeason = season;
        renderVideos();
      });
      els.listSeasons.appendChild(li);
    }
  }

  function renderVideos() {
    if (!currentSeason) return renderSeasons();
    els.paneDivisions.hidden = true;
    els.paneSeasons.hidden = true;
    els.paneVideos.hidden = false;
    els.videosTitle.textContent = `${currentDivision.name} / ${currentSeason.name}`;
    renderBreadcrumb();

    const videos = currentSeason.children || [];
    if (videos.length === 0) {
      els.listVideos.innerHTML = `<li class="empty">No videos in this season yet.</li>`;
      return;
    }

    els.listVideos.innerHTML = '';
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
      els.listVideos.appendChild(li);
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
