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

let tray = null;
let dashboardWin = null;
let wizardWin = null;
let pollTimer = null;

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

function trayIconForState(overall) {
  const color = overall === 'ok' ? '#10b981' : overall === 'warn' ? '#f59e0b' : '#ef4444';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
  return nativeImage.createFromBuffer(Buffer.from(svg));
}

function setTrayMenu(state = { overall: 'unknown' }) {
  if (!tray) return;
  tray.setImage(trayIconForState(state.overall));
  tray.setToolTip(`Waterboys — ${state.overall}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Status: ${state.overall}`, enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: openDashboard },
    { label: 'Run setup wizard', click: openWizard },
    { type: 'separator' },
    { label: 'Open logs folder', click: () => shell.openPath(paths.logsDir()) },
    { label: 'Quit', click: () => { app.quit(); } }
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

  ipcMain.handle('config:summary', () => config.summary());
  ipcMain.handle('config:read',    () => config.read());
  ipcMain.handle('config:write',   (_e, partial) => config.write(partial));

  ipcMain.handle('password:hash', async (_e, pwd) => {
    const { passwordHash } = await password.hash(pwd);
    return { passwordHash, jwtSecret: password.newJwtSecret() };
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
      event.sender.send('tunnel:progress', { phase: 'login', chunk });
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

  tray = new Tray(trayIconForState('unknown'));
  tray.on('click', () => openDashboard());
  setTrayMenu({ overall: 'unknown' });

  if (!config.exists() || !config.summary().hasPassword) {
    openWizard();
  } else {
    openDashboard();
  }

  startPolling();
});

app.on('window-all-closed', (e) => {
  // Keep app alive in tray.
  e.preventDefault && e.preventDefault();
});

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
});
