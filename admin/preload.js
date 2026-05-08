const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  app: {
    paths:         () => invoke('app:paths'),
    openExternal:  (url) => invoke('app:open-external', url),
    openPath:      (p) => invoke('app:open-path', p),
    selectFolder:  (defaultPath) => invoke('app:select-folder', defaultPath),
    openWizard:    () => invoke('app:open-wizard'),
    openDashboard: () => invoke('app:open-dashboard'),
    platform:      () => invoke('app:platform')
  },
  config: {
    summary: () => invoke('config:summary'),
    read:    () => invoke('config:read'),
    write:   (partial) => invoke('config:write', partial)
  },
  password: {
    hash: (pwd) => invoke('password:hash', pwd)
  },
  prereqs: {
    check:   () => invoke('prereqs:check'),
    install: (key) => invoke('prereqs:install', key)
  },
  services: {
    names:     () => invoke('services:names'),
    status:    () => invoke('services:status'),
    install:   () => invoke('services:install'),
    start:     (name) => invoke('services:start', name),
    stop:      (name) => invoke('services:stop', name),
    restart:   (name) => invoke('services:restart', name),
    uninstall: () => invoke('services:uninstall')
  },
  tunnel: {
    summary:     () => invoke('tunnel:summary'),
    login:       () => invoke('tunnel:login'),
    create:      () => invoke('tunnel:create'),
    writeConfig: (args) => invoke('tunnel:write-config', args),
    routeDns:    (hostname) => invoke('tunnel:route-dns', hostname),
    onProgress:  (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('tunnel:progress', listener);
      return () => ipcRenderer.removeListener('tunnel:progress', listener);
    }
  },
  health: {
    all:  () => invoke('health:all'),
    poll: () => invoke('health:poll'),
    onUpdate: (handler) => {
      const listener = (_e, state) => handler(state);
      ipcRenderer.on('status:update', listener);
      return () => ipcRenderer.removeListener('status:update', listener);
    }
  },
  logs: {
    tail:          (name, lines) => invoke('logs:tail', name, lines),
    recentErrors:  (n) => invoke('logs:recent-errors', n),
    openFolder:    () => invoke('logs:open-folder')
  }
});
