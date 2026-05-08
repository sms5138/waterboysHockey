const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spawn } = require('child_process');
const { run, which } = require('./exec');
const paths = require('./paths');

const TUNNEL_NAME = 'waterboys';
const DEFAULT_TIMEOUT_MS = 60_000;

function isLoggedIn() {
  return fs.existsSync(paths.cloudflaredCert());
}

// Resolve cloudflared once, then run with a bounded timeout. All non-login
// cloudflared calls go through here so a hung binary surfaces as a clean
// timeout error rather than a forever-spinning UI.
async function cf(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cloudflaredPath = await which('cloudflared');
  if (!cloudflaredPath) {
    return { code: -1, stdout: '', stderr: 'cloudflared not on PATH', missing: true, timedOut: false };
  }
  return run(cloudflaredPath, args, { timeoutMs });
}

async function login(onProgress = () => {}) {
  const cloudflaredPath = await which('cloudflared');
  if (!cloudflaredPath) {
    return { ok: false, error: 'cloudflared not found on PATH. Install with `winget install Cloudflare.cloudflared` and reopen this window.' };
  }
  if (isLoggedIn()) return { ok: true, alreadyLoggedIn: true };

  // Make sure the dir cloudflared writes cert.pem into exists. Some Windows
  // setups don't create it on first run and the login fails silently.
  fs.mkdirSync(paths.cloudflaredHome(), { recursive: true });

  return new Promise((resolve) => {
    // Login can take minutes (user authenticates in browser) so no timeout.
    // stdio: ['ignore', ...] keeps cloudflared from blocking on stdin reads.
    const child = spawn(cloudflaredPath, ['tunnel', 'login'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); onProgress(d.toString()); });
    child.stderr.on('data', (d) => { stderr += d.toString(); onProgress(d.toString()); });
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, stdout, stderr, error: `cloudflared spawn failed: ${err.message}` });
    });
    child.on('close', (code) => {
      const loggedIn = isLoggedIn();
      let error = null;
      if (code !== 0) {
        error = `cloudflared exited with code ${code}.\n${stderr.trim() || stdout.trim() || '(no output)'}`;
      } else if (!loggedIn) {
        error = `cloudflared exited cleanly but cert.pem was not written to ${paths.cloudflaredCert()}. Did you complete the browser auth?`;
      }
      resolve({ ok: code === 0 && loggedIn, code, stdout, stderr, error });
    });
  });
}

async function listTunnels() {
  const r = await cf(['tunnel', 'list', '--output', 'json']);
  if (r.code !== 0) return [];
  try {
    // cloudflared returns the literal JSON value `null` (not `[]`) when zero
    // tunnels exist for the cert. Normalize so callers always get an array.
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function findTunnel(name = TUNNEL_NAME) {
  const tunnels = await listTunnels();
  return tunnels.find(t => t.name === name) || null;
}

async function create(name = TUNNEL_NAME) {
  const existing = await findTunnel(name);
  if (existing) return { ok: true, alreadyExisted: true, id: existing.id, name };
  const r = await cf(['tunnel', 'create', name]);
  if (r.code !== 0) {
    const reason = r.timedOut
      ? `cloudflared timed out after ${DEFAULT_TIMEOUT_MS / 1000}s. Try running 'cloudflared tunnel create ${name}' from PowerShell to see what's wrong.`
      : (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`);
    return { ok: false, code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, error: reason };
  }
  const created = await findTunnel(name);
  return { ok: Boolean(created), id: created && created.id, stdout: r.stdout, stderr: r.stderr };
}

function writeConfigYml({ tunnelId, hostname, port }) {
  const credentials = path.join(paths.cloudflaredHome(), `${tunnelId}.json`);
  const doc = {
    tunnel: TUNNEL_NAME,
    'credentials-file': credentials,
    ingress: [
      { hostname, service: `http://localhost:${port}` },
      { service: 'http_status:404' }
    ]
  };
  fs.mkdirSync(paths.cloudflaredHome(), { recursive: true });
  fs.writeFileSync(paths.cloudflaredConfigYml(), yaml.dump(doc));
  return paths.cloudflaredConfigYml();
}

async function routeDns(hostname) {
  return cf(['tunnel', 'route', 'dns', TUNNEL_NAME, hostname]);
}

// Best-effort tunnel teardown for the full-uninstall flow. cleanup releases
// active connectors so delete -f doesn't fail with "tunnel has active
// connections". The DNS CNAME is left behind; Cloudflare scrubs unrouted
// records on its own and removing the record requires API access we don't have.
async function deleteTunnel(name = TUNNEL_NAME) {
  const cleanup = await cf(['tunnel', 'cleanup', name]);
  const del     = await cf(['tunnel', 'delete', '-f', name]);
  return {
    ok: del.code === 0,
    steps: [
      { label: 'cloudflared tunnel cleanup', code: cleanup.code, stdout: cleanup.stdout, stderr: cleanup.stderr },
      { label: 'cloudflared tunnel delete',  code: del.code,     stdout: del.stdout,     stderr: del.stderr }
    ]
  };
}

async function summary() {
  const cloudflaredPath = await which('cloudflared');
  if (!cloudflaredPath) {
    return { installed: false, loggedIn: false, tunnel: null, configYml: null, tunnelLookupFailed: false };
  }

  // findTunnel uses cf() which has a timeout. If it returns null we still
  // need to surface whether that's "no tunnel exists" or "the lookup failed."
  let tunnel = null;
  let tunnelLookupFailed = false;
  try {
    const r = await cf(['tunnel', 'list', '--output', 'json']);
    if (r.code === 0) {
      const parsed = JSON.parse(r.stdout);
      const tunnels = Array.isArray(parsed) ? parsed : [];
      tunnel = tunnels.find(t => t.name === TUNNEL_NAME) || null;
    } else {
      tunnelLookupFailed = true;
    }
  } catch {
    tunnelLookupFailed = true;
  }

  const configYmlPath = paths.cloudflaredConfigYml();
  let configYml = null;
  if (fs.existsSync(configYmlPath)) {
    try { configYml = yaml.load(fs.readFileSync(configYmlPath, 'utf8')); } catch {}
  }
  return {
    installed: true,
    loggedIn: isLoggedIn(),
    tunnel,
    tunnelLookupFailed,
    configYml,
    configYmlPath
  };
}

module.exports = {
  TUNNEL_NAME,
  isLoggedIn,
  login,
  listTunnels,
  findTunnel,
  create,
  writeConfigYml,
  routeDns,
  summary,
  deleteTunnel
};
