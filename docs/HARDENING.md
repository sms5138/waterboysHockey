# Hardening the Waterboys Server

This server runs on a Windows PC at home and is reachable from the public internet through a Cloudflare Tunnel. The two guarantees the box should provide are:

1. The Waterboys service can read **only** the configured video folder. Plex data and the rest of the system are off-limits.
2. The Waterboys service cannot send **any** other network traffic. Inbound from cloudflared on loopback only; no LAN, no internet egress.

The setup wizard's "Hardening" step automates most of this. The rest you do once in the Cloudflare dashboard, plus a backup plan.

## What the wizard does

When you click each "Apply" button on the Hardening step:

1. **Dedicated service account.** Creates a local user `WaterboysSvc` with a 64-char random password and no group memberships. Both the Node server and the Cloudflare tunnel run as this account instead of LocalSystem. A successful Node-app exploit then has the rights of `WaterboysSvc` — nothing more.

2. **Folder permissions.** Runs `icacls` to:
   - Grant `WaterboysSvc` **read-only** on your videoRoot (and all subfolders).
   - Grant `WaterboysSvc` read on `%PROGRAMDATA%\Waterboys\config.json` and modify on `%PROGRAMDATA%\Waterboys\logs\` so it can append the access log.
   - **Deny** `WaterboysSvc` everything on every Plex install path it can find: `%LOCALAPPDATA%\Plex Media Server`, `%PROGRAMDATA%\Plex Media Server`, `C:\Program Files\Plex`, `C:\Program Files (x86)\Plex`, plus your full user profile dir.
   - Deny ACEs always win over inherited allows, so even if `WaterboysSvc` somehow inherits read on a parent dir, the explicit deny blocks it.

3. **Outbound network lockdown.** Three Windows Firewall rules:
   - `Waterboys: deny node outbound` — block all outbound from `node.exe` running as the service account.
   - `Waterboys: allow node loopback` — re-allow 127.0.0.1 / ::1 so internal calls work.
   - `Waterboys: allow cloudflared outbound` — cloudflared is the only thing on the box allowed to reach the internet, and only it can do so.

   With these in place, even a Node RCE can't scan the LAN or talk to a C2 server.

In addition to the wizard's Apply steps, the codebase already does:

- The Express app binds to `127.0.0.1` only. `192.168.x.x:8088` is unreachable to anyone else on the LAN regardless of firewall rules.
- The Cloudflare Tunnel `config.yml` has exactly one ingress rule (`api.waterboyshockey.com → http://localhost:8088`) plus a 404 catch-all. The tunnel is not a generic reverse proxy.
- The `/api/file` and `/api/download` endpoints normalize paths and reject anything that escapes videoRoot (see [server/stream.js:5-14](../server/stream.js#L5-L14)).
- Auth is via `HttpOnly; Secure; SameSite=None` cookie — tokens don't leak via Cloudflare logs, browser history, or referers.
- Rate limits: 5 login attempts/min/IP, 120 API requests/min/IP overall (range continuations exempted).

## What you set up manually: Cloudflare Access

Cloudflare Access (Zero Trust) puts a second auth gate at Cloudflare's edge. Anyone hitting `api.waterboyshockey.com` without an Access cookie is challenged — they don't even reach your home box. This stops scrapers, vuln scanners, and exploit kits cold. **Free for up to 50 users.**

Steps in the Cloudflare dashboard:

1. Go to https://one.dash.cloudflare.com → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: `api.waterboyshockey.com`.
3. Identity providers: enable **One-time PIN** (email magic link). No account or SSO setup needed.
4. **Policy**: Action = Allow, Selector = `Emails`, list each teammate's email address.
5. **Bypass policy** (important): add a second policy with Action = Bypass, Path = `/api/health`. This keeps the Waterboys app's own status dashboard's end-to-end check working.
6. Session duration: 24h.
7. Tick "I've set this up" on the wizard's Hardening step.

Verify by opening `https://api.waterboyshockey.com` from a browser that's not signed in — you should see a Cloudflare email-PIN challenge before any Waterboys content.

## Backups

The wizard does **not** back anything up. You should:

- **videoRoot**: replicate weekly to an external drive or cloud storage. `rclone sync` to Backblaze B2 or S3 is cheap and resumable. Plex's library can be regenerated from the originals; the originals themselves are the irreplaceable thing.
- **`%PROGRAMDATA%\Waterboys\config.json`**: this file holds the bcrypt password hash and the JWT secret. If you lose it, everyone is logged out, and you can't issue new tokens until you replace `jwtSecret` (which then logs everyone out anyway). Snapshot it after the wizard finishes.
- **Plex's own backup**: Plex's settings/database backup is independent of this app. Configure that in Plex if you care.

## What NOT to expose through the tunnel

> The Cloudflare Tunnel `config.yml` has exactly **one** ingress rule, pointing at `http://localhost:8088`, plus the 404 catch-all. **Do not add other rules.**

Specifically, never add ingress for:
- `localhost:32400` (Plex) — exposing Plex via the tunnel bypasses Plex's own auth assumptions.
- `localhost:445` (SMB) — file-sharing over the public internet.
- `localhost:3389` (RDP) — remote desktop.
- `localhost:8123` (Home Assistant) or any other home-automation web UI.
- The router admin UI on the LAN.

Each new ingress rule is a new internet-facing door into your house. The Waterboys app is built to assume there's exactly one door, with two locks (CF Access + the team password) on it.

## Verifying the lockdown worked

From an Administrator PowerShell on the Windows box:

```powershell
# 1. Folder scope. Everything but videoRoot should be Access Denied.
runas /user:WaterboysSvc /noprofile "powershell -NoExit -Command Get-Acl <videoRoot>"
# In the new shell:
dir <videoRoot>                                # succeeds
dir "$env:LOCALAPPDATA\Plex Media Server"      # Access Denied
dir "$env:USERPROFILE\Documents"               # Access Denied
type "$env:PROGRAMDATA\Waterboys\config.json"  # succeeds (read-only)

# 2. Network scope. All non-loopback should fail.
Test-NetConnection 127.0.0.1   -Port 8088 -WarningAction SilentlyContinue   # TcpTestSucceeded: True
Test-NetConnection 192.168.1.1 -Port 22   -WarningAction SilentlyContinue   # TcpTestSucceeded: False
Test-NetConnection 8.8.8.8     -Port 53   -WarningAction SilentlyContinue   # TcpTestSucceeded: False
```

From a phone on cellular (off your home wifi), open `https://api.waterboyshockey.com/api/health`:
- Without CF Access: you get `{"ok": true}`.
- With CF Access: you get the email-PIN challenge first, then `{"ok": true}` after auth (because we bypassed `/api/health`).

Hit `https://api.waterboyshockey.com/api/tree` similarly — without a session cookie, the server returns 401, regardless of CF Access state.

## If the dashboard goes red

The dashboard's "Recent errors" panel surfaces 401/403/429 lines from the access log. If you see persistent 429s from a single IP, that's brute-force or a rogue scraper — note the IP and either block it at Cloudflare or add a custom WAF rule. If the **public reachability** card is red but **local server** is green, the tunnel itself is the problem; check the Cloudflare tunnel service status and the cloudflared.err.log via the dashboard's "Open logs folder" button.
