# Waterboys Hockey Club — Video Hub

Private video sharing site for the team. Static site is hosted on GitHub Pages at **waterboyshockey.com** and talks to a small Node.js server running on the home Windows machine via a named Cloudflare Tunnel at **api.waterboyshockey.com**.

```
Browser  →  waterboyshockey.com (GitHub Pages)
              │
              └── XHR/stream ──→  api.waterboyshockey.com (Cloudflare Tunnel)
                                    └──→  localhost:8088 on home Windows server
                                            └──→  Video files on disk
```

## Repo layout

- [docs/](docs/) — the static site served by GitHub Pages (apex: `waterboyshockey.com`)
- [server/](server/) — the Node.js app that runs on the Windows server

## Setup at a glance

1. **Server side** — see [server/README.md](server/README.md) for the Windows install steps: Node.js, npm install, password hash, Cloudflare Tunnel pointed at `api.waterboyshockey.com`.
2. **Site side** — already wired up: [docs/CNAME](docs/CNAME) sets the custom domain, [docs/config.js](docs/config.js) points at the API. In GitHub repo Settings → Pages, set source to **Deploy from branch: `main` /docs**, then add the DNS records described in the server README.
3. Open `https://waterboyshockey.com`, sign in with the team password.

## Customizing the look

- Drop logo PNGs into [docs/assets/](docs/assets/) (`logo.png`, `favicon.png`, `banner.png`).
- Edit team colors at the top of [docs/styles.css](docs/styles.css) (`--team-primary`, `--team-secondary`, `--team-accent`).

## Folder structure on the server

```
<videoRoot>/
├── U18/                    ← Division
│   ├── 2024-25/            ← Season
│   │   ├── vs Sharks.mp4
│   │   └── vs Bears.mp4
│   └── 2025-26/
│       └── vs Wolves.mp4
└── U16/
    └── 2025-26/
        └── ...
```

Top level = divisions. Second level = seasons. Third level = video files.
