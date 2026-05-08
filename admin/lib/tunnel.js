const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spawn } = require('child_process');
const { run, which } = require('./exec');
const paths = require('./paths');

const TUNNEL_NAME = 'waterboys';

function isLoggedIn() {
  return fs.existsSync(paths.cloudflaredCert());
}

async function login(onProgress = () => {}) {
  const cloudflared = await which('cloudflared');
  if (!cloudflared) return { ok: false, error: 'cloudflared not on PATH' };
  if (isLoggedIn()) return { ok: true, alreadyLoggedIn: true };

  return new Promise((resolve) => {
    const child = spawn('cloudflared', ['tunnel', 'login'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); onProgress(d.toString()); });
    child.stderr.on('data', (d) => { stderr += d.toString(); onProgress(d.toString()); });
    child.on('close', (code) => {
      resolve({ ok: code === 0 && isLoggedIn(), code, stdout, stderr });
    });
  });
}

async function listTunnels() {
  const { code, stdout } = await run('cloudflared', ['tunnel', 'list', '--output', 'json']);
  if (code !== 0) return [];
  try { return JSON.parse(stdout); } catch { return []; }
}

async function findTunnel(name = TUNNEL_NAME) {
  const tunnels = await listTunnels();
  return tunnels.find(t => t.name === name) || null;
}

async function create(name = TUNNEL_NAME) {
  const existing = await findTunnel(name);
  if (existing) return { ok: true, alreadyExisted: true, id: existing.id, name };
  const { code, stdout, stderr } = await run('cloudflared', ['tunnel', 'create', name]);
  if (code !== 0) return { ok: false, code, stdout, stderr };
  const created = await findTunnel(name);
  return { ok: Boolean(created), id: created && created.id, stdout, stderr };
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
  return run('cloudflared', ['tunnel', 'route', 'dns', TUNNEL_NAME, hostname]);
}

async function summary() {
  const cloudflared = await which('cloudflared');
  if (!cloudflared) {
    return { installed: false, loggedIn: false, tunnel: null, configYml: null };
  }
  const tunnel = await findTunnel();
  const configYmlPath = paths.cloudflaredConfigYml();
  let configYml = null;
  if (fs.existsSync(configYmlPath)) {
    try { configYml = yaml.load(fs.readFileSync(configYmlPath, 'utf8')); } catch {}
  }
  return {
    installed: true,
    loggedIn: isLoggedIn(),
    tunnel,
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
  summary
};
