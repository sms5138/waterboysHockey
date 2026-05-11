// Multi-step setup wizard. Each step renders into #step-host and exposes
// async validate() / save() hooks; the footer drives navigation.

const STATE = {
  index: 0,
  data: {} // collected user inputs
};

const STEPS = [
  { id: 'welcome',   title: 'Welcome',     render: renderWelcome },
  { id: 'prereqs',   title: 'Prereqs',     render: renderPrereqs },
  { id: 'libraries', title: 'Libraries',   render: renderLibraries },
  { id: 'passwords', title: 'Passwords',   render: renderPasswords },
  { id: 'network',   title: 'Network',     render: renderNetwork },
  { id: 'tunnel',    title: 'Tunnel',      render: renderTunnel },
  { id: 'services',  title: 'Services',    render: renderServices },
  { id: 'hardening', title: 'Hardening',   render: renderHardening },
  { id: 'verify',    title: 'Verify',      render: renderVerify }
];

const LIBRARY_ORDER = ['waterboys', 'youth'];
const LIBRARY_META = {
  waterboys: { label: 'Waterboys', levels: ['Division', 'Season'], placeholder: 'D:\\Videos\\Waterboys Hockey' },
  youth:     { label: 'Youth League', levels: ['League', 'Team', 'Season'], placeholder: 'D:\\Videos\\Youth' }
};

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

async function renderLibraries(el, data) {
  const cfg = await api.config.read();
  data.libraries = data.libraries || {};
  for (const key of LIBRARY_ORDER) {
    const stored = (cfg.libraries && cfg.libraries[key]) || {};
    data.libraries[key] = data.libraries[key] || { videoRoot: stored.videoRoot || '' };
  }

  const fields = LIBRARY_ORDER.map(key => {
    const meta = LIBRARY_META[key];
    const current = data.libraries[key].videoRoot;
    return `
      <div class="field">
        <label for="root-${key}">${escapeHtml(meta.label)} folder <span class="muted">(${meta.levels.join(' → ')})</span></label>
        <div class="row">
          <input type="text" id="root-${key}" value="${escapeHtml(current)}" placeholder="${escapeHtml(meta.placeholder)}" />
          <button class="secondary" id="btn-pick-${key}" style="flex: 0 0 auto">Browse…</button>
        </div>
        <div class="help">Expected layout: <code>${meta.levels.map(l => `&lt;${l}&gt;`).join('/')}/*.mp4</code>. Leave blank to skip this library.</div>
      </div>`;
  }).join('');

  el.innerHTML = panel('Video libraries',
    'Set the folder for each library you want to share. Each library uses a different password, and viewers only see the one they signed in to.',
    fields
  );

  for (const key of LIBRARY_ORDER) {
    document.getElementById(`btn-pick-${key}`).onclick = async () => {
      const current = document.getElementById(`root-${key}`).value;
      const picked = await api.app.selectFolder(current);
      if (picked) document.getElementById(`root-${key}`).value = picked;
    };
  }

  return {
    validate: async () => {
      const values = {};
      for (const key of LIBRARY_ORDER) {
        values[key] = document.getElementById(`root-${key}`).value.trim();
      }
      const filled = Object.values(values).filter(Boolean);
      if (filled.length === 0) {
        alert('Set a folder for at least one library.');
        return false;
      }
      data.libraries = {};
      for (const key of LIBRARY_ORDER) {
        data.libraries[key] = { videoRoot: values[key] };
      }
      return true;
    },
    save: async () => {
      const partial = { libraries: {} };
      for (const key of LIBRARY_ORDER) {
        if (data.libraries[key].videoRoot) {
          partial.libraries[key] = { videoRoot: data.libraries[key].videoRoot };
        }
      }
      await api.config.write(partial);
    }
  };
}

async function renderPasswords(el, data) {
  const summary = await api.config.summary();
  data.passwords = data.passwords || {};

  const activeLibraries = LIBRARY_ORDER.filter(key => {
    // Skip a library that has neither a saved root nor one entered this session.
    const stored = (summary.libraries && summary.libraries[key]) || {};
    const inSession = (data.libraries && data.libraries[key] && data.libraries[key].videoRoot);
    return inSession || stored.videoRoot;
  });

  if (activeLibraries.length === 0) {
    el.innerHTML = panel('Passwords',
      'No libraries are configured. Go back and set a video folder for at least one library.',
      ''
    );
    return { validate: async () => false };
  }

  const fields = activeLibraries.map(key => {
    const meta = LIBRARY_META[key];
    const stored = (summary.libraries && summary.libraries[key]) || {};
    const hint = stored.hasPassword
      ? 'A password is already set. Leave blank to keep it.'
      : 'Set the password viewers will use to sign in.';
    return `
      <fieldset class="field" style="border:1px solid var(--border,#2a3450); padding:12px; border-radius:8px; margin-bottom:12px">
        <legend style="padding:0 6px"><strong>${escapeHtml(meta.label)}</strong></legend>
        <p class="muted" style="margin-top:0">${hint}</p>
        <div class="field">
          <label for="pw-${key}-1">Password${stored.hasPassword ? ' (blank = keep current)' : ''}</label>
          <input type="password" id="pw-${key}-1" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="pw-${key}-2">Confirm</label>
          <input type="password" id="pw-${key}-2" autocomplete="new-password" />
        </div>
      </fieldset>`;
  }).join('');

  el.innerHTML = panel('Library passwords',
    'Each library has its own password. Viewers only see the library matching the password they sign in with.',
    fields + `<p class="muted">Stored as bcrypt hashes; the plaintext is never written to disk.</p>`
  );

  return {
    validate: async () => {
      data.passwords = {};
      for (const key of activeLibraries) {
        const pw1 = document.getElementById(`pw-${key}-1`).value;
        const pw2 = document.getElementById(`pw-${key}-2`).value;
        const stored = (summary.libraries && summary.libraries[key]) || {};
        if (!pw1) {
          if (!stored.hasPassword) {
            alert(`${LIBRARY_META[key].label}: set a password.`);
            return false;
          }
          continue;
        }
        if (pw1.length < 6) {
          alert(`${LIBRARY_META[key].label}: password must be at least 6 characters.`);
          return false;
        }
        if (pw1 !== pw2) {
          alert(`${LIBRARY_META[key].label}: passwords do not match.`);
          return false;
        }
        data.passwords[key] = pw1;
      }
      return true;
    },
    save: async () => {
      for (const [key, plaintext] of Object.entries(data.passwords)) {
        const r = await api.password.setForLibrary(key, plaintext);
        if (!r.ok) {
          alert(`Failed to save ${LIBRARY_META[key].label} password: ${r.error || ''}`);
          throw new Error(r.error || 'password save failed');
        }
      }
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
  // Skeleton first so the user never sees an empty panel if cloudflared is slow.
  el.innerHTML = panel('Cloudflare Tunnel', 'Checking cloudflared status…', '');

  let summary;
  try {
    summary = await Promise.race([
      api.tunnel.summary(),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('cloudflared status check timed out after 60s')), 60_000
      ))
    ]);
  } catch (err) {
    summary = { installed: false, loggedIn: false, tunnel: null, error: err.message };
  }

  data.tunnelHostname = data.tunnelHostname || (data.allowedOrigin
    ? data.allowedOrigin.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').replace(/^/, 'api.')
    : 'api.waterboyshockey.com');

  const warningBanner = summary.error
    ? `<div class="banner warn" style="margin-bottom:12px">⚠️ ${escapeHtml(summary.error)}. Try clicking <strong>Refresh</strong> below, or run <code>cloudflared tunnel list</code> in PowerShell to see what's wrong.</div>`
    : (summary.tunnelLookupFailed
        ? `<div class="banner warn" style="margin-bottom:12px">⚠️ Couldn't fetch the tunnel list from Cloudflare. The cert may be present but the API call failed or timed out.</div>`
        : '');

  el.innerHTML = panel('Cloudflare Tunnel',
    'Creates a named tunnel and points api.waterboyshockey.com at this PC. You only do this once.',
    `${warningBanner}
     <div class="field">
       <label>1. Sign in to Cloudflare</label>
       <div class="row">
         <div id="login-state">${statusDot(summary.loggedIn ? 'ok' : 'down')} ${summary.loggedIn ? 'Already signed in' : 'Not signed in'}</div>
         <button id="btn-login" class="secondary" style="flex: 0 0 auto" ${summary.loggedIn ? 'disabled' : ''}>Sign in…</button>
         <button id="btn-login-refresh" class="secondary" style="flex: 0 0 auto" title="Re-check cert.pem (use after running cloudflared tunnel login manually)">Refresh</button>
       </div>
       <pre class="log" id="login-log" style="display:none"></pre>
       <div class="help">If sign-in keeps failing, open PowerShell and run <code>cloudflared tunnel login</code> directly. After it succeeds, click Refresh.</div>
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
    logEl.textContent = 'Spawning cloudflared tunnel login…\n';
    const off = api.tunnel.onProgress((p) => { logEl.textContent += p.chunk; });
    const r = await api.tunnel.login();
    off();
    logEl.textContent += `\n[exit code: ${r.code}]\n`;
    if (r.error) logEl.textContent += `\n${r.error}\n`;
    if (!r.ok) {
      btn.disabled = false;
      btn.textContent = 'Retry sign in';
      alert(r.error || 'cloudflared login failed. See log below the button for details.');
    } else {
      btn.textContent = 'Signed in';
      document.getElementById('login-state').innerHTML = `${statusDot('ok')} Signed in`;
    }
  };

  document.getElementById('btn-login-refresh').onclick = async () => {
    const s = await api.tunnel.summary();
    if (s.loggedIn) {
      document.getElementById('login-state').innerHTML = `${statusDot('ok')} Signed in`;
      const loginBtn = document.getElementById('btn-login');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signed in';
    } else {
      document.getElementById('login-state').innerHTML = `${statusDot('down')} Still not signed in`;
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
    logEl.textContent = '';
    const r = await api.services.install();
    const errorBlock = r.error ? `[error] ${r.error}\n\n` : '';
    const stepLines = (r.steps || []).map(s => {
      const tag = s.code === 0 ? 'ok' : (s.allowFail ? 'skipped' : 'fail');
      return `[${tag}] ${s.label}\n  ${s.stdout || '(no output)'}`;
    }).join('\n\n');
    logEl.textContent = (errorBlock + stepLines).trim() || '(no output returned)';
    if (r.ok) {
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

async function renderHardening(el) {
  const platform = await api.app.platform();
  el.innerHTML = panel('Lock down the box',
    'Three steps narrow the service’s reach to just the video folder and block all other network traffic.',
    `<div id="hardening-panels">
       <div class="card" style="margin-bottom: 10px">
         <div class="title-row" id="row-svc">${statusDot('busy')}<div class="label">1. Dedicated service account</div></div>
         <div class="muted">Drops the service from LocalSystem to a low-privilege local user (WaterboysSvc).</div>
         <pre class="log" id="log-svc" style="display:none"></pre>
         <div style="margin-top: 10px"><button id="btn-svc">Apply</button></div>
       </div>
       <div class="card" style="margin-bottom: 10px">
         <div class="title-row" id="row-acl">${statusDot('busy')}<div class="label">2. Folder permissions</div></div>
         <div class="muted">Read-only on videoRoot, deny on Plex data folders and your user profile.</div>
         <pre class="log" id="log-acl" style="display:none"></pre>
         <div style="margin-top: 10px"><button id="btn-acl">Apply</button></div>
       </div>
       <div class="card" style="margin-bottom: 10px">
         <div class="title-row" id="row-fw">${statusDot('busy')}<div class="label">3. Outbound network lockdown</div></div>
         <div class="muted">Blocks node.exe outbound except loopback. cloudflared keeps its outbound to Cloudflare.</div>
         <pre class="log" id="log-fw" style="display:none"></pre>
         <div style="margin-top: 10px"><button id="btn-fw">Apply</button></div>
       </div>
       <div class="card">
         <div class="title-row">${statusDot('warn')}<div class="label">Optional: Cloudflare Access</div></div>
         <div class="muted">Adds a second auth gate at the Cloudflare edge — free for up to 50 users. Configure in the Zero Trust dashboard.</div>
         <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center">
           <button class="secondary" id="btn-cf-open">Open Zero Trust dashboard</button>
           <label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; text-transform: none; letter-spacing: 0">
             <input type="checkbox" id="cf-ack" /> I’ve set this up
           </label>
         </div>
       </div>
     </div>`
  );

  if (platform !== 'win32') {
    document.querySelectorAll('#hardening-panels button[id^=btn-svc],#hardening-panels button[id^=btn-acl],#hardening-panels button[id^=btn-fw]')
      .forEach(b => { b.disabled = true; b.title = 'Windows-only'; });
  }

  const refreshStatus = async () => {
    const s = await api.hardening.status();
    document.getElementById('row-svc').firstElementChild.className =
      `dot ${s.serviceAccountAppliedAt ? 'ok' : 'warn'}`;
    document.getElementById('row-acl').firstElementChild.className =
      `dot ${s.aclsAppliedAt ? 'ok' : 'warn'}`;
    const fw = s.firewallRulesPresent || {};
    const fwOk = fw.node && fw.loopback && fw.cloudflared && fw.cloudflaredLan;
    document.getElementById('row-fw').firstElementChild.className =
      `dot ${fwOk ? 'ok' : 'warn'}`;
    document.getElementById('cf-ack').checked = !!s.cloudflareAccessAcknowledged;
  };
  await refreshStatus();

  const wireApply = (btnId, logId, fn) => {
    document.getElementById(btnId).onclick = async () => {
      const btn = document.getElementById(btnId);
      const logEl = document.getElementById(logId);
      btn.disabled = true; btn.textContent = 'Applying…';
      logEl.style.display = 'block';
      logEl.textContent = '';
      const r = await fn();
      const steps = (r && r.steps) || [];
      const errorBlock = (r && r.error) ? `[error] ${r.error}\n\n` : '';
      const stepLines = steps.map(s => {
        const tag = s.code === 0 ? 'ok' : (s.allowFail ? 'skipped' : 'fail');
        return `[${tag}] ${s.label || (s.args || []).join(' ')}\n  ${s.stdout || '(no output)'}`;
      }).join('\n\n');
      logEl.textContent = (errorBlock + stepLines).trim() || '(no output)';
      btn.disabled = false; btn.textContent = (r && r.ok) ? 'Done' : 'Retry';
      await refreshStatus();
    };
  };

  wireApply('btn-svc', 'log-svc', () => api.hardening.applyServiceAccount());
  wireApply('btn-acl', 'log-acl', () => api.hardening.applyAcls());
  wireApply('btn-fw',  'log-fw',  () => api.hardening.applyFirewall());

  document.getElementById('btn-cf-open').onclick =
    () => api.app.openExternal('https://one.dash.cloudflare.com/');
  document.getElementById('cf-ack').onchange = (e) =>
    api.hardening.acknowledgeCfAccess(e.target.checked);

  return {
    skippable: true,
    validate: async () => {
      const s = await api.hardening.status();
      const fw = s.firewallRulesPresent || {};
      const allDone = s.serviceAccountAppliedAt && s.aclsAppliedAt
                    && fw.node && fw.loopback && fw.cloudflared && fw.cloudflaredLan;
      if (allDone) return true;
      return confirm('One or more hardening steps haven\'t been applied. Continue anyway?');
    }
  };
}

async function renderVerify(el) {
  el.innerHTML = panel('Verify everything is working', '',
    `<div id="verify-cards">Running checks…</div>`
  );

  const refresh = async () => {
    const s = await api.health.all();
    const items = [s.local, s.tunnel, s.e2e, ...(s.folders || [])];
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
  api.app.version().then((v) => { document.getElementById('app-version').textContent = `v${v}`; });
  const platform = await api.app.platform();
  if (platform !== 'win32') {
    document.getElementById('platform-note').textContent = `dev preview on ${platform} — Windows-only steps will be no-ops`;
  }
  show(0);
});
