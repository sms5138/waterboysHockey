# Waterboys Admin

Electron app: setup wizard + system-tray status dashboard for the Waterboys video server. The packaged installer (`WaterboysSetup-<version>.exe`) bundles the `server/` source so end users only download one file.

## Layout

```
admin/
  main.js             Electron main process: tray, windows, IPC handlers, status polling
  preload.js          contextBridge — exposes window.api to the renderer
  lib/
    paths.js          install-aware path resolution (dev vs packaged)
    config.js         read/write %PROGRAMDATA%/Waterboys/config.json
    password.js       bcrypt hash + jwt secret generator
    prereqs.js        node/cloudflared/nssm presence + winget install
    services.js       NSSM install / start / stop / status / uninstall
    tunnel.js         cloudflared login / create / write config.yml / route DNS
    health.js         the four status checks (local, tunnel svc, end-to-end, folder)
    logs.js           tail %PROGRAMDATA%/Waterboys/logs/*.log
    exec.js           spawn / which helpers
  renderer/
    wizard.html, wizard.js          first-run + re-runnable setup wizard
    dashboard.html, dashboard.js    status dashboard
    app.css                         shared styles (Oilers blue/orange/white)
```

## Config location

Per-machine config lives at:

- `%PROGRAMDATA%\Waterboys\config.json` (Windows)
- `~/.waterboys/config.json` (other platforms — dev only)

The Windows service runs `node.exe server.js` with `WATERBOYS_CONFIG` pointing at that file, so reinstalling the app does not wipe the config.

## Develop

```sh
cd admin
npm install
npm start
```

On macOS/Linux the Windows-only steps (NSSM, winget) are no-ops; the four status cards still work for the local + end-to-end checks if you run the Node server separately.

## Build a Windows installer

```sh
npm run build
```

Produces `admin/dist/WaterboysSetup-<version>.exe` (NSIS, x64, per-user). The installer is unsigned, so Windows SmartScreen will warn on first run — click "More info → Run anyway".
