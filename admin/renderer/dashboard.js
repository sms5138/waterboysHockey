const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function bannerText(overall) {
  if (overall === 'ok')   return { cls: 'ok',   text: 'All systems operational.' };
  if (overall === 'warn') return { cls: 'warn', text: 'Running, but check the warnings below.' };
  if (overall === 'down') return { cls: 'down', text: 'Something is broken — see the cards below.' };
  return { cls: '', text: 'Checking…' };
}

function renderCards(state) {
  const items = [state.local, state.tunnel, state.e2e, state.folder, state.hardening].filter(Boolean);
  $('cards').innerHTML = items.map(item => `
    <div class="card">
      <div class="title-row">
        <span class="dot ${item.state || ''}"></span>
        <div class="label">${escapeHtml(item.label)}</div>
      </div>
      <div class="detail">${escapeHtml(item.detail || '')}</div>
      ${item.url ? `<div class="url">${escapeHtml(item.url)}</div>` : ''}
    </div>
  `).join('');
}

function renderBanner(state) {
  const b = bannerText(state.overall);
  $('banner').className = `banner ${b.cls}`;
  $('banner').textContent = b.text;
  if (state.at) {
    $('last-checked').textContent = `last checked ${new Date(state.at).toLocaleTimeString()}`;
  }
}

async function renderErrors() {
  const errs = await api.logs.recentErrors(20);
  const body = $('errors-body');
  if (!errs.length) {
    body.className = 'empty';
    body.textContent = 'none';
    return;
  }
  body.className = '';
  body.innerHTML = `<ul>${errs.map(e =>
    `<li><span class="src">${escapeHtml(e.source.replace(/Err$/, ''))}</span>${escapeHtml(e.line)}</li>`
  ).join('')}</ul>`;
}

async function refresh() {
  const state = await api.health.all();
  renderBanner(state);
  renderCards(state);
  await renderErrors();
}

async function changePassword() {
  const pw = prompt('New team password (min 6 characters):');
  if (!pw) return;
  if (pw.length < 6) { alert('Too short.'); return; }
  const confirm2 = prompt('Confirm password:');
  if (pw !== confirm2) { alert('Passwords do not match.'); return; }
  const { passwordHash } = await api.password.hash(pw);
  await api.config.write({ passwordHash });
  await api.services.restart('WaterboysVideoServer');
  alert('Password updated. Server restarted.');
  refresh();
}

window.addEventListener('DOMContentLoaded', async () => {
  api.app.version().then((v) => { $('app-version').textContent = `v${v}`; });

  $('btn-refresh').onclick = refresh;
  $('btn-restart-server').onclick = async () => {
    $('btn-restart-server').disabled = true;
    await api.services.restart('WaterboysVideoServer');
    $('btn-restart-server').disabled = false;
    refresh();
  };
  $('btn-restart-tunnel').onclick = async () => {
    $('btn-restart-tunnel').disabled = true;
    await api.services.restart('WaterboysCloudflared');
    $('btn-restart-tunnel').disabled = false;
    refresh();
  };
  $('btn-change-pw').onclick = changePassword;
  $('btn-wizard').onclick = () => api.app.openWizard();
  $('btn-logs').onclick = () => api.logs.openFolder();
  $('btn-uninstall').onclick = () => { $('uninstall-modal').hidden = false; };
  $('uninstall-cancel').onclick = () => { $('uninstall-modal').hidden = true; };

  $('uninstall-confirm').onclick = async () => {
    const opts = {
      removeFirewallRules: $('opt-fw').checked,
      restorePermissions:  $('opt-acl').checked,
      removeServiceUser:   $('opt-user').checked,
      deleteTunnel:        $('opt-tunnel').checked,
      deleteConfigData:    $('opt-data').checked
    };
    const log = $('uninstall-log');
    log.hidden = false;
    log.textContent = '';
    $('uninstall-confirm').disabled = true;

    const off = api.app.onUninstallProgress((step) => {
      const mark = step.state === 'ok' ? '✓' : step.state === 'fail' ? '✗' : '…';
      log.textContent += `${mark} ${step.label}\n`;
    });

    await api.app.fullUninstall(opts);
    off();

    $('uninstall-confirm').hidden = true;
    $('uninstall-finalize').hidden = false;
  };

  $('uninstall-finalize').onclick = () => api.app.runWindowsUninstaller();

  api.health.onUpdate((state) => {
    renderBanner(state);
    renderCards(state);
    renderErrors();
  });

  await refresh();
});
