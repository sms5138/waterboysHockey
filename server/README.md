# Waterboys Video Server (Windows)

Runs on the home Windows server, streams videos to the public site (`https://waterboyshockey.com`) through a **named** Cloudflare Tunnel.

## URL layout

| Role | URL | Hosted by |
|---|---|---|
| Public site | `https://waterboyshockey.com` | GitHub Pages with a custom domain |
| API (this server) | `https://api.waterboyshockey.com` | Cloudflare Tunnel → your Windows box |

Both are stable and won't rotate between restarts.

## What you'll end up with

- Node server listening on `localhost:8088` (Plex stays on 32400, no conflict).
- A Cloudflare Tunnel publishing it at `https://api.waterboyshockey.com`.
- Both running as Windows services so they survive reboots.
- A "Waterboys" tray icon with a status dashboard (server up? tunnel up? site reachable? video folder OK?).

## Recommended: GUI installer

Download `WaterboysSetup-<version>.exe` from the repo's GitHub Releases page and run it on your Windows PC.

A setup wizard walks you through:

1. Installing missing prerequisites (`node`, `cloudflared`, `nssm`) via winget.
2. Picking the video folder.
3. Setting the team password.
4. Confirming the port and allowed origin.
5. Signing in to Cloudflare and creating the named tunnel + DNS record.
6. Registering both Windows services and starting them.
7. Verifying end-to-end with live status checks.

After install the app sits in the system tray; click it for the status dashboard. The wizard can be re-run any time from the tray menu.

The rest of this README documents the manual install path — useful for debugging or when you'd rather not run the GUI.

## Prerequisite — domain on Cloudflare

The domain `waterboyshockey.com` should already be on your Cloudflare account (you mentioned registering it through Cloudflare). Confirm by logging into the Cloudflare dashboard → it should be listed as an active site. If it shows "Pending nameservers," wait until it's active before continuing.

Install the local tools:

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
winget install --id NSSM.NSSM         # only needed for the Windows service step
winget install --id Git.Git
```

Reopen PowerShell so the new commands are on PATH.

## 1. Get the code and install dependencies

```powershell
cd C:\Users\sean
git clone https://github.com/<your-username>/waterboysHockey.git
cd waterboysHockey\server
npm install
```

## 2. Create your config

```powershell
copy config.example.json config.json
npm run hash-password
```

The hash-password helper prompts for the team password and prints both a `passwordHash` and a fresh random `jwtSecret`. Open `config.json` in a text editor and:

- paste in `passwordHash` and `jwtSecret`
- set `videoRoot` to your hockey folder, e.g. `C:/Users/sean/Videos/Hockey`
- leave `allowedOrigin` as `https://waterboyshockey.com`
- leave `port` at `8088` unless you have a reason to change it

Use forward slashes in the path (Windows accepts them) or escape backslashes (`C:\\Users\\sean\\Videos\\Hockey`).

## 3. Smoke-test the server

```powershell
npm start
```

You should see:

```
Waterboys video server listening on http://localhost:8088
Serving videos from: C:/Users/sean/Videos/Hockey
```

In a second PowerShell window, confirm login works:

```powershell
curl -Method POST -Body (@{password='YOUR_PASSWORD'} | ConvertTo-Json) -ContentType 'application/json' http://localhost:8088/api/login
```

You should get `{"token": "...", "expiresAt": ...}` back. Stop the server (`Ctrl+C`) before the next step.

## 4. Set up the named Cloudflare Tunnel at api.waterboyshockey.com

A *named* tunnel keeps the same URL across restarts. Run these from PowerShell:

```powershell
# Authenticate cloudflared with your Cloudflare account (opens browser).
cloudflared tunnel login

# Create the tunnel. This prints a tunnel UUID and writes a credentials JSON
# under %USERPROFILE%\.cloudflared\<UUID>.json.
cloudflared tunnel create waterboys
```

Create the tunnel config file at `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: waterboys
credentials-file: C:\Users\sean\.cloudflared\<TUNNEL-UUID>.json

ingress:
  - hostname: api.waterboyshockey.com
    service: http://localhost:8088
  - service: http_status:404
```

Replace `<TUNNEL-UUID>` with the value printed by `cloudflared tunnel create`.

Create the DNS record so `api.waterboyshockey.com` routes through the tunnel:

```powershell
cloudflared tunnel route dns waterboys api.waterboyshockey.com
```

Now run the tunnel:

```powershell
cloudflared tunnel run waterboys
```

In a third PowerShell, confirm the tunnel works end-to-end:

```powershell
curl -Method POST -Body (@{password='YOUR_PASSWORD'} | ConvertTo-Json) -ContentType 'application/json' https://api.waterboyshockey.com/api/login
```

You should see `{"token": "...", "expiresAt": ...}` come back. Stop both `npm start` and `cloudflared` before installing as services.

## 5. Set up GitHub Pages with the waterboyshockey.com custom domain

The repo already includes `docs/CNAME` (contents: `waterboyshockey.com`) and `docs/config.js` already points to `https://api.waterboyshockey.com`, so on the GitHub side this is just a few clicks:

1. **In GitHub repo Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` /docs
   - Custom domain: GitHub will auto-detect `waterboyshockey.com` from the CNAME file. Save.
   - Tick **Enforce HTTPS** once it becomes available (a few minutes after DNS propagates).

2. **In Cloudflare DNS** (dash.cloudflare.com → waterboyshockey.com → DNS):
   Add these records — Cloudflare's CNAME flattening makes the apex record work:

   | Type  | Name | Content                       | Proxy status |
   |-------|------|-------------------------------|--------------|
   | CNAME | `@`  | `<your-github-username>.github.io` | DNS only (gray cloud) |
   | CNAME | `www`| `<your-github-username>.github.io` | DNS only (gray cloud) |

   **Important**: leave the proxy as **DNS only** (gray cloud) for both. GitHub Pages handles its own TLS, and proxying through Cloudflare can cause redirect loops or break Pages' HTTPS provisioning.

   The `api` subdomain that `cloudflared tunnel route dns` created in step 4 should already be in DNS as a proxied (orange cloud) CNAME pointing to `<tunnel-uuid>.cfargotunnel.com` — leave it proxied.

3. **Wait 5–15 minutes** for DNS propagation. Then visit `https://waterboyshockey.com` — the login screen should appear.

## 6. (Optional) Run as Windows services so it survives reboots

```powershell
PowerShell -ExecutionPolicy Bypass -File install-service.ps1
```

This registers `WaterboysVideoServer` and `WaterboysCloudflared` with NSSM, set to auto-start at boot. Logs land in `server\logs\`.

To uninstall later:

```powershell
nssm remove WaterboysVideoServer confirm
nssm remove WaterboysCloudflared confirm
```

## Updating the team password later

```powershell
cd C:\Users\sean\waterboysHockey\server
npm run hash-password
```

Paste the new `passwordHash` into `config.json`. (You don't need to change `jwtSecret`, but rotating it logs everyone out, which is sometimes what you want.) Restart the server service:

```powershell
nssm restart WaterboysVideoServer
```

## Troubleshooting

- **`config.json not found`** — you forgot step 2.
- **`videoRoot does not exist`** — fix the path; use forward slashes.
- **Login returns 401 from the site but works locally** — check `allowedOrigin` is exactly `https://waterboyshockey.com` (no trailing slash, no `www.`).
- **CORS error in browser console** — same fix; or if you visit `www.waterboyshockey.com`, either add it as a second allowed origin or set up a redirect from `www` → apex in Cloudflare.
- **Video plays but won't seek** — confirm the browser dev tools show `206 Partial Content` responses. If you see `200 OK` for video requests, something is stripping the `Range` header.
- **Tunnel says `Unauthorized` or fails DNS lookup** — re-run `cloudflared tunnel route dns waterboys <hostname>`.
- **Plex stopped working** — unrelated to this app (Plex is on 32400, we use 8088). Check Plex's own logs.
