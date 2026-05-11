const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const paths    = require('./lib/paths');
const config   = require('./lib/config');
const password = require('./lib/password');
const prereqs  = require('./lib/prereqs');
const services = require('./lib/services');
const tunnel   = require('./lib/tunnel');
const health   = require('./lib/health');
const logs     = require('./lib/logs');
const acls     = require('./lib/acls');
const firewall = require('./lib/firewall');

let tray = null;
let dashboardWin = null;
let wizardWin = null;
let pollTimer = null;
let isQuitting = false;

function makeWindow(file, opts = {}) {
  const win = new BrowserWindow({
    width: opts.width || 920,
    height: opts.height || 720,
    show: false,
    backgroundColor: '#0a1633',
    title: 'Waterboys',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', file));
  win.once('ready-to-show', () => win.show());
  return win;
}

function openWizard() {
  if (wizardWin && !wizardWin.isDestroyed()) {
    wizardWin.focus();
    return;
  }
  wizardWin = makeWindow('wizard.html', { width: 760, height: 640 });
  wizardWin.on('closed', () => { wizardWin = null; });
}

function openDashboard() {
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.focus();
    return;
  }
  dashboardWin = makeWindow('dashboard.html');
  dashboardWin.on('closed', () => { dashboardWin = null; });
}

const TRAY_ICONS = {
  ok:      path.join(__dirname, 'build', 'tray-ok.ico'),
  warn:    path.join(__dirname, 'build', 'tray-warn.ico'),
  down:    path.join(__dirname, 'build', 'tray-down.ico'),
  unknown: path.join(__dirname, 'build', 'tray-unknown.ico')
};

function trayIconForState(overall) {
  const file = TRAY_ICONS[overall] || TRAY_ICONS.unknown;
  return nativeImage.createFromPath(file);
}

function setTrayMenu(state = { overall: 'unknown' }) {
  if (!tray) return;
  const version = app.getVersion();
  try { tray.setImage(trayIconForState(state.overall)); } catch {}
  tray.setToolTip(`Waterboys v${version} — ${state.overall}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Waterboys v${version}`, enabled: false },
    { label: `Status: ${state.overall}`, enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: openDashboard },
    { label: 'Run setup wizard', click: openWizard },
    { type: 'separator' },
    { label: 'Open logs folder', click: () => shell.openPath(paths.logsDir()) },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

async function pollStatus() {
  try {
    const state = await health.all();
    setTrayMenu(state);
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.webContents.send('status:update', state);
    }
  } catch (err) {
    setTrayMenu({ overall: 'down' });
  }
}

function startPolling() {
  pollStatus();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStatus, 15000);
}

function registerIpc() {
  ipcMain.handle('app:paths', () => ({
    configFile: paths.configFile(),
    configDir: paths.configDir(),
    logsDir: paths.logsDir(),
    serverDir: paths.serverDir()
  }));
  ipcMain.handle('app:open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('app:open-path', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:select-folder', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: defaultPath || undefined
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:open-wizard',    () => openWizard());
  ipcMain.handle('app:open-dashboard', () => openDashboard());
  ipcMain.handle('app:platform',       () => process.platform);
  ipcMain.handle('app:version',        () => app.getVersion());

  ipcMain.handle('config:summary', () => config.summary());
  ipcMain.handle('config:read',    () => config.read());
  ipcMain.handle('config:write',   (_e, partial) => config.write(partial));

  ipcMain.handle('password:hash', async (_e, pwd) => {
    const { passwordHash } = await password.hash(pwd);
    return { passwordHash, jwtSecret: password.newJwtSecret() };
  });

  // Hashes the given plaintext and stores it under libraries[libraryKey].
  // Used by the dashboard's Change Password modal and the wizard's per-library
  // password fields. Returns { ok } so callers don't have to read config back.
  ipcMain.handle('password:set-for-library', async (_e, libraryKey, plaintext) => {
    if (!libraryKey || typeof libraryKey !== 'string') {
      return { ok: false, error: 'libraryKey required' };
    }
    if (typeof plaintext !== 'string' || plaintext.length < 6) {
      return { ok: false, error: 'password must be at least 6 characters' };
    }
    const cfg = config.read();
    if (!cfg.libraries || !cfg.libraries[libraryKey]) {
      return { ok: false, error: `unknown library: ${libraryKey}` };
    }
    const { passwordHash } = await password.hash(plaintext);
    const partial = { libraries: { [libraryKey]: { passwordHash } } };
    if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) {
      partial.jwtSecret = password.newJwtSecret();
    }
    config.write(partial);
    return { ok: true };
  });

  ipcMain.handle('prereqs:check',   () => prereqs.check());
  ipcMain.handle('prereqs:install', (_e, key) => prereqs.install(key));

  ipcMain.handle('services:status',    () => services.status());
  ipcMain.handle('services:install',   () => services.install());
  ipcMain.handle('services:start',     (_e, name) => services.start(name));
  ipcMain.handle('services:stop',      (_e, name) => services.stop(name));
  ipcMain.handle('services:restart',   (_e, name) => services.restart(name));
  ipcMain.handle('services:uninstall', () => services.uninstall());
  ipcMain.handle('services:names',     () => ({ server: services.SERVER_SVC, tunnel: services.TUNNEL_SVC }));

  ipcMain.handle('tunnel:summary',     () => tunnel.summary());
  ipcMain.handle('tunnel:login',       async (event) => {
    return tunnel.login((chunk) => {
      if (event.sender.isDestroyed()) return;
      try { event.sender.send('tunnel:progress', { phase: 'login', chunk }); } catch {}
    });
  });
  ipcMain.handle('tunnel:create',      () => tunnel.create());
  ipcMain.handle('tunnel:write-config', (_e, args) => {
    const written = tunnel.writeConfigYml(args);
    return { ok: true, path: written };
  });
  ipcMain.handle('tunnel:route-dns', (_e, hostname) => tunnel.routeDns(hostname));

  ipcMain.handle('health:all',   () => health.all());
  ipcMain.handle('health:poll',  () => pollStatus());

  ipcMain.handle('logs:tail',         (_e, name, lines) => logs.tail(name, lines));
  ipcMain.handle('logs:recent-errors', (_e, n) => logs.recentErrors(n));
  ipcMain.handle('logs:open-folder',  () => shell.openPath(paths.logsDir()));

  // Hardening: dedicated service account, NTFS ACLs, outbound firewall.
  // Each operation is a single batched UAC prompt.
  ipcMain.handle('hardening:apply-service-account', async () => {
    const r = await services.ensureServiceUserAndBind();
    if (r.ok) {
      config.write({
        hardening: {
          ...config.read().hardening,
          serviceAccount: services.SERVICE_USER,
          serviceAccountAppliedAt: new Date().toISOString()
        }
      });
      // Best-effort restart so services pick up the new ObjectName. Each is its
      // own UAC prompt; if the user denies, the dashboard's Restart buttons can
      // do this later.
      await services.restart(services.SERVER_SVC);
      await services.restart(services.TUNNEL_SVC);
    }
    return r;
  });

  ipcMain.handle('hardening:apply-acls', async () => {
    const cfg = config.read();
    const r = await acls.applyAcls({
      videoRoots: Object.values(cfg.libraries || {}).map(l => l.videoRoot).filter(Boolean),
      configDir: paths.configDir(),
      logsDir:   paths.logsDir(),
      userName:  services.SERVICE_USER
    });
    if (r.ok) {
      config.write({
        hardening: { ...cfg.hardening, aclsAppliedAt: new Date().toISOString() }
      });
    }
    return r;
  });

  ipcMain.handle('hardening:apply-firewall', async () => {
    const sid = await services.getUserSid(services.SERVICE_USER);
    const nodePath = await require('./lib/exec').which('node');
    const cloudflaredPath = await require('./lib/exec').which('cloudflared');
    const r = await firewall.applyFirewallRules({ nodePath, cloudflaredPath, svcSid: sid });
    if (r.ok) {
      config.write({
        hardening: { ...config.read().hardening, firewallAppliedAt: new Date().toISOString() }
      });
    }
    return r;
  });

  ipcMain.handle('hardening:status', async () => {
    const cfg = config.read();
    const present = await firewall.rulesPresent();
    const userPresent = await services.userExists(services.SERVICE_USER);
    return {
      ...cfg.hardening,
      firewallRulesPresent: present,
      serviceUserPresent: userPresent
    };
  });

  ipcMain.handle('hardening:acknowledge-cf-access', async (_e, ack) => {
    const cfg = config.read();
    return config.write({
      hardening: { ...cfg.hardening, cloudflareAccessAcknowledged: Boolean(ack) }
    });
  });

  // Full uninstall orchestrator. Each step streams a progress event so the
  // renderer can show a live ✓/✗ log. All steps are idempotent — safe to run
  // even from partial-state boxes (services already gone, ACLs already
  // cleaned, etc.).
  ipcMain.handle('app:full-uninstall', async (event, options = {}) => {
    const send = (step) => {
      try { event.sender.send('app:uninstall-progress', step); } catch {}
    };
    const steps = [];
    const runStep = async (label, fn) => {
      send({ label, state: 'running' });
      try {
        const r = await fn();
        const ok = r === undefined ? true : (r.ok !== false);
        const step = { label, state: ok ? 'ok' : 'fail', detail: r };
        steps.push(step);
        send(step);
        return ok;
      } catch (err) {
        const step = { label, state: 'fail', detail: { error: err.message } };
        steps.push(step);
        send(step);
        return false;
      }
    };

    // Stop services first so their files aren't locked when we touch ACLs
    // or remove the user account they're running as.
    await runStep('Stop services', async () => {
      await services.stop(services.SERVER_SVC);
      await services.stop(services.TUNNEL_SVC);
      return { ok: true };
    });

    await runStep('Remove Windows services', () => services.uninstall());

    if (options.removeFirewallRules) {
      await runStep('Remove firewall rules', () => firewall.removeFirewallRules());
    }
    if (options.restorePermissions) {
      await runStep('Restore NTFS permissions', () => acls.removeAcls({
        videoRoots: Object.values(config.read().libraries || {}).map(l => l.videoRoot).filter(Boolean),
        configDir: paths.configDir(),
        logsDir:   paths.logsDir(),
        userName:  services.SERVICE_USER
      }));
    }
    if (options.removeServiceUser) {
      await runStep('Remove WaterboysSvc account', () => services.removeServiceUser());
    }
    if (options.deleteTunnel) {
      await runStep('Delete Cloudflare tunnel', () => tunnel.deleteTunnel());
    }
    if (options.deleteConfigData) {
      await runStep('Delete config and logs', async () => {
        const dir = paths.configDir();
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        return { ok: true };
      });
    }

    return { ok: steps.every(s => s.state === 'ok'), steps };
  });

  // Spawn the NSIS uninstaller and quit. The uninstaller path is derived from
  // the running EXE so it works regardless of where the user installed.
  ipcMain.handle('app:run-windows-uninstaller', () => {
    const installDir = path.dirname(app.getPath('exe'));
    const uninstaller = path.join(installDir, 'Uninstall Waterboys.exe');
    if (!fs.existsSync(uninstaller)) {
      return { ok: false, error: `uninstaller not found at ${uninstaller}` };
    }
    shell.openPath(uninstaller);
    isQuitting = true;
    setTimeout(() => app.quit(), 1500);
    return { ok: true };
  });
}

function singleInstance() {
  const got = app.requestSingleInstanceLock();
  if (!got) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => openDashboard());
  return true;
}

app.whenReady().then(() => {
  if (!singleInstance()) return;

  config.ensureDir();
  registerIpc();

  // Open a window FIRST so the user always sees something on launch.
  if (!config.exists() || !config.summary().hasPassword) {
    openWizard();
  } else {
    openDashboard();
  }

  // Tray is best-effort; failure here must not crash the app.
  try {
    tray = new Tray(trayIconForState('unknown'));
    tray.on('click', () => openDashboard());
    setTrayMenu({ overall: 'unknown' });
  } catch (err) {
    console.error('Tray init failed:', err);
    tray = null;
  }

  startPolling();
});

app.on('window-all-closed', () => {
  // With a tray, stay alive in the background. Without one, the user has
  // no way to bring the app back, so quit (matches macOS-like behavior).
  if (!tray || isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
});
