// Multi-step setup wizard. Each step renders into #step-host and exposes
// async validate() / save() hooks; the footer drives navigation.

const STATE = {
  index: 0,
  data: {} // collected user inputs
};

const STEPS = [
  { id: 'welcome',   title: 'Welcome',     render: renderWelcome },
  { id: 'prereqs',   title: 'Prereqs',     render: renderPrereqs },
  { id: 'folder',    title: 'Video folder', render: renderFolder },
  { id: 'password',  title: 'Password',    render: renderPassword },
  { id: 'network',   title: 'Network',     render: renderNetwork },
  { id: 'tunnel',    title: 'Tunnel',      render: renderTunnel },
  { id: 'services',  title: 'Services',    render: renderServices },
  { id: 'verify',    title: 'Verify',      render: renderVerify }
];

let current = null; // { validate, save } returned by render

const host = () => document.getElementById('step-host');
const btnBack = () => document.getElementById('btn-back');
const btnNext = () => document.getElementById('btn-next');
const btnSkip = () => document.getElementById('btn-skip');

function renderStepper() {
  const el = document.getElementById('stepper');
  el.innerHTML = STEPS.map((s, i) => {
    const cls = i === STATE.index ? 'active' : i < STATE.index ? 'done' : '';
    return `<span class="step ${cls}">${i + 1}. ${s.title}</span>`;
  }).join('');
}

async function show(index) {
  STATE.index = index;
  renderStepper();
  host().innerHTML = '';
  const step = STEPS[index];
  current = await step.render(host(), STATE.data) || {};
  btnBack().style.visibility = index === 0 ? 'hidden' : 'visible';
  btnNext().textContent = index === STEPS.length - 1 ? 'Finish' : 'Next';
  btnSkip().style.display = current.skippable ? 'inline-block' : 'none';
}

async function next() {
  if (current && current.validate) {
    const ok = await current.validate();
    if (!ok) return;
  }
  if (current && current.save) await current.save();
  if (STATE.index < STEPS.length - 1) {
    show(STATE.index + 1);
  } else {
    finish();
  }
}

async function back() {
  if (STATE.index > 0) show(STATE.index - 1);
}

async function skip() {
  if (STATE.index < STEPS.length - 1) show(STATE.index + 1);
}

async function finish() {
  await api.app.openDashboard();
  window.close();
}

// ---------- helpers ---------------------------------------------------------

function statusDot(state) {
  return `<span class="dot ${state || ''}"></span>`;
}

function panel(title, lede, body) {
  return `
    <div class="panel">
      <h2>${title}</h2>
      ${lede ? `<p class="lede">${lede}</p>` : ''}
      ${body}
    </div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- step renderers --------------------------------------------------

async function renderWelcome(el) {
  el.innerHTML = panel(
    'Set up the Waterboys video server',
    'This wizard will configure your server, install the Cloudflare Tunnel, and register both as Windows services so they start automatically.',
    `<p>You'll need:</p>
     <ul>
       <li>A Cloudflare account that owns <strong>waterboyshockey.com</strong></li>
       <li>Your team password (you'll set or change it in this wizard)</li>
       <li>The folder on this PC where the hockey videos live</li>
     </ul>
     <p class="muted">You can re-run this wizard any time from the tray icon.</p>`
  );
  return {};
}

async function renderPrereqs(el) {
  el.innerHTML = panel('Required tools',
    'Node.js, Cloudflared, and NSSM must be installed. We can install missing ones for you via winget.',
    `<ul class="prereq-list" id="prereq-list"><li>Checking…</li></ul>`
  );

  async function refresh() {
    const checks = await api.prereqs.check();
    const platform = await api.app.platform();
    const ul = document.getElementById('prereq-list');
    ul.innerHTML = Object.entries(checks).map(([key, v]) => `
      <li>
        ${statusDot(v.installed ? 'ok' : 'down')}
        <div class="name">
          <strong>${v.name}</strong>
          <span class="version">${v.installed ? escapeHtml(v.version || 'installed') : 'not installed'}</span>
        </div>
        ${v.installed
          ? ''
          : platform === 'win32'
            ? `<button data-install="${key}" class="secondary">Install</button>`
            : `<span class="muted">install on Windows</span>`}
      </li>
    `).join('');

    ul.querySelectorAll('button[data-install]').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Installing…';
        const r = await api.prereqs.install(btn.dataset.install);
        if (!r.ok) alert(`Install failed:\n${r.stderr || r.error || ''}`);
        await refresh();
      };
    });
    return checks;
  }

  const checks = await refresh();

  return {
    skippable: true,
    validate: async () => {
      const c = await api.prereqs.check();
      const missing = Object.values(c).filter(v => !v.installed).map(v => v.name);
      if (missing.length === 0) return true;
      return confirm(`Missing: ${missing.join(', ')}.\nContinue anyway?`);
    }
  };
}

async function renderFolder(el, data) {
  const cfg = await api.config.read();
  data.videoRoot = data.videoRoot || cfg.videoRoot || '';
  el.innerHTML = panel('Where are your hockey videos?',
    'This must be a folder on this computer. Subfolders below it become divisions and seasons in the website.',
    `<div class="field">
       <label for="videoRoot">Video folder</label>
       <div class="row">
         <input type="text" id="videoRoot" value="${escapeHtml(data.videoRoot)}" placeholder="C:\\Users\\sean\\Videos\\Hockey" />
         <button class="secondary" id="btn-pick" style="flex: 0 0 auto">Browse…</button>
       </div>
       <div class="help">Expected layout: <code>&lt;Division&gt;/&lt;Season&gt;/*.mp4</code></div>
     </div>`
  );

  document.getElementById('btn-pick').onclick = async () => {
    const picked = await api.app.selectFolder(data.videoRoot);
    if (picked) document.getElementById('videoRoot').value = picked;
  };

  return {
    validate: async () => {
      const v = document.getElementById('videoRoot').value.trim();
      if (!v) { alert('Pick a folder.'); return false; }
      data.videoRoot = v;
      return true;
    },
    save: async () => {
      await api.config.write({ videoRoot: data.videoRoot });
    }
  };
}

async function renderPassword(el, data) {
  const summary = await api.config.summary();
  el.innerHTML = panel('Team password',
    summary.hasPassword
      ? 'A password is already configured. Leave blank to keep it.'
      : 'Pick the password your teammates will use to sign in to the site.',
    `<div class="field">
       <label for="pw1">Password${summary.hasPassword ? ' (leave blank to keep current)' : ''}</label>
       <input type="password" id="pw1" autocomplete="new-password" />
     </div>
     <div class="field">
       <label for="pw2">Confirm</label>
       <input type="password" id="pw2" autocomplete="new-password" />
     </div>
     <p class="muted">Stored as a bcrypt hash; the plaintext is never written to disk.</p>`
  );

  return {
    validate: async () => {
      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;
      if (!pw1 && summary.hasPassword) { data.skipPassword = true; return true; }
      if (pw1.length < 6) { alert('Password must be at least 6 characters.'); return false; }
      if (pw1 !== pw2) { alert('Passwords do not match.'); return false; }
      data.password = pw1;
      data.skipPassword = false;
      return true;
    },
    save: async () => {
      if (data.skipPassword) return;
      const { passwordHash, jwtSecret } = await api.password.hash(data.password);
      const existing = await api.config.read();
      const partial = { passwordHash };
      if (!existing.jwtSecret || existing.jwtSecret.length < 32) partial.jwtSecret = jwtSecret;
      await api.config.write(partial);
    }
  };
}

async function renderNetwork(el, data) {
  const cfg = await api.config.read();
  data.port = data.port || cfg.port || 8088;
  data.allowedOrigin = data.allowedOrigin || cfg.allowedOrigin || 'https://waterboyshockey.com';
  el.innerHTML = panel('Network settings',
    'Defaults work for the standard waterboyshockey.com setup.',
    `<div class="row">
       <div class="field">
         <label for="port">Local port</label>
         <input type="number" id="port" value="${data.port}" min="1" max="65535" />
         <div class="help">Plex uses 32400 — leave 8088 unless conflict.</div>
       </div>
       <div class="field">
         <label for="origin">Allowed origin</label>
         <input type="text" id="origin" value="${escapeHtml(data.allowedOrigin)}" />
         <div class="help">Public site URL. CORS will only allow this exact origin.</div>
       </div>
     </div>`
  );
  return {
    validate: async () => {
      const port = parseInt(document.getElementById('port').value, 10);
      const origin = document.getElementById('origin').value.trim();
      if (!port || port < 1 || port > 65535) { alert('Port must be 1–65535.'); return false; }
      if (!/^https:\/\//.test(origin)) { alert('Allowed origin should start with https://'); return false; }
      data.port = port;
      data.allowedOrigin = origin;
      return true;
    },
    save: async () => {
      await api.config.write({ port: data.port, allowedOrigin: data.allowedOrigin });
    }
  };
}

async function renderTunnel(el, data) {
  const summary = await api.tunnel.summary();
  data.tunnelHostname = data.tunnelHostname || (data.allowedOrigin
    ? data.allowedOrigin.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').replace(/^/, 'api.')
    : 'api.waterboyshockey.com');

  el.innerHTML = panel('Cloudflare Tunnel',
    'Creates a named tunnel and points api.waterboyshockey.com at this PC. You only do this once.',
    `<div class="field">
       <label>1. Sign in to Cloudflare</label>
       <div class="row">
         <div>${statusDot(summary.loggedIn ? 'ok' : 'down')} ${summary.loggedIn ? 'Already signed in' : 'Not signed in'}</div>
         <button id="btn-login" class="secondary" style="flex: 0 0 auto" ${summary.loggedIn ? 'disabled' : ''}>Sign in…</button>
       </div>
       <pre class="log" id="login-log" style="display:none"></pre>
     </div>
     <div class="field">
       <label>2. Tunnel</label>
       <div class="row">
         <div id="tunnel-state">${summary.tunnel ? `<span class="dot ok"></span> waterboys (id ${escapeHtml(summary.tunnel.id)})` : `${statusDot('down')} not created`}</div>
         <button id="btn-create" class="secondary" style="flex: 0 0 auto" ${summary.tunnel ? 'disabled' : ''}>Create tunnel</button>
       </div>
     </div>
     <div class="field">
       <label for="hostname">3. Public hostname</label>
       <input type="text" id="hostname" value="${escapeHtml(data.tunnelHostname)}" />
       <div class="help">api subdomain that your site will call. DNS gets pointed at the tunnel automatically.</div>
     </div>`
  );

  document.getElementById('btn-login').onclick = async () => {
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Waiting for browser…';
    const logEl = document.getElementById('login-log');
    logEl.style.display = 'block';
    logEl.textContent = '';
    const off = api.tunnel.onProgress((p) => { logEl.textContent += p.chunk; });
    const r = await api.tunnel.login();
    off();
    if (!r.ok) {
      alert('Login failed. Check the log for details.');
    } else {
      btn.textContent = 'Signed in';
    }
  };

  document.getElementById('btn-create').onclick = async () => {
    const btn = document.getElementById('btn-create');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    const r = await api.tunnel.create();
    if (!r.ok) {
      alert('Tunnel create failed:\n' + (r.stderr || r.error || ''));
      btn.disabled = false;
      btn.textContent = 'Create tunnel';
      return;
    }
    document.getElementById('tunnel-state').innerHTML =
      `<span class="dot ok"></span> waterboys (id ${escapeHtml(r.id)})`;
    btn.textContent = r.alreadyExisted ? 'Already exists' : 'Created';
  };

  return {
    validate: async () => {
      const s = await api.tunnel.summary();
      if (!s.loggedIn) { alert('Sign in to Cloudflare first.'); return false; }
      if (!s.tunnel) { alert('Create the tunnel first.'); return false; }
      const host = document.getElementById('hostname').value.trim();
      if (!host) { alert('Hostname required.'); return false; }
      data.tunnelHostname = host;
      data.tunnelId = s.tunnel.id;
      return true;
    },
    save: async () => {
      const cfg = await api.config.read();
      await api.tunnel.writeConfig({ tunnelId: data.tunnelId, hostname: data.tunnelHostname, port: cfg.port });
      await api.tunnel.routeDns(data.tunnelHostname);
    }
  };
}

async function renderServices(el) {
  el.innerHTML = panel('Install Windows services',
    'Registers both pieces with NSSM so they start at boot. May prompt for administrator access.',
    `<div id="svc-state">Click <strong>Install services</strong> to begin.</div>
     <pre class="log" id="svc-log" style="display:none"></pre>
     <div class="row" style="margin-top: 12px">
       <button id="btn-install" style="flex: 0 0 auto">Install services</button>
       <div class="spacer"></div>
     </div>`
  );

  let installed = false;
  document.getElementById('btn-install').onclick = async () => {
    const btn = document.getElementById('btn-install');
    btn.disabled = true;
    btn.textContent = 'Installing…';
    const logEl = document.getElementById('svc-log');
    logEl.style.display = 'block';
    const r = await api.services.install();
    logEl.textContent = (r.steps || []).map(s =>
      `[${s.code === 0 ? 'ok' : 'fail'}] ${s.label}\n  stdout: ${s.stdout}\n  stderr: ${s.stderr}`
    ).join('\n\n');
    if (r.ok) {
      await api.services.start('WaterboysVideoServer');
      await api.services.start('WaterboysCloudflared');
      btn.textContent = 'Installed';
      installed = true;
    } else {
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  };

  return {
    validate: async () => {
      if (installed) return true;
      const status = await api.services.status();
      if (status.server.installed && status.tunnel.installed) return true;
      return confirm('Services not installed yet. Continue anyway?');
    }
  };
}

async function renderVerify(el) {
  el.innerHTML = panel('Verify everything is working', '',
    `<div id="verify-cards">Running checks…</div>`
  );

  const refresh = async () => {
    const s = await api.health.all();
    const items = [s.local, s.tunnel, s.e2e, s.folder];
    document.getElementById('verify-cards').innerHTML = items.map(item => `
      <div class="card" style="margin-bottom: 8px">
        <div class="title-row">
          ${statusDot(item.state)}
          <div class="label">${escapeHtml(item.label)}</div>
        </div>
        <div class="detail">${escapeHtml(item.detail || '')}</div>
        ${item.url ? `<div class="url">${escapeHtml(item.url)}</div>` : ''}
      </div>
    `).join('');
    return s;
  };
  await refresh();
  setTimeout(refresh, 3000);

  return {};
}

// ---------- boot ------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  btnBack().onclick = back;
  btnNext().onclick = next;
  btnSkip().onclick = skip;
  const platform = await api.app.platform();
  if (platform !== 'win32') {
    document.getElementById('platform-note').textContent = `dev preview on ${platform} — Windows-only steps will be no-ops`;
  }
  show(0);
});
