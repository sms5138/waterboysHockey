const fs = require('fs');
const path = require('path');
const config = require('./config');
const services = require('./services');

const TIMEOUT_MS = 4000;

async function fetchWithTimeout(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const ms = Date.now() - start;
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, ms, body };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

async function localServer() {
  const cfg = config.read();
  const r = await fetchWithTimeout(`http://127.0.0.1:${cfg.port}/api/health`);
  return {
    label: 'Local server',
    state: r.ok ? 'ok' : 'down',
    url: `http://127.0.0.1:${cfg.port}/api/health`,
    detail: r.ok ? `${r.ms}ms` : (r.error || `HTTP ${r.status}`)
  };
}

async function tunnelService() {
  const s = await services.status();
  const t = s.tunnel;
  if (!t.installed) {
    return { label: 'Cloudflare tunnel', state: 'missing', detail: t.error || 'service not installed' };
  }
  const ok = /running/i.test(t.state);
  return {
    label: 'Cloudflare tunnel',
    state: ok ? 'ok' : 'down',
    detail: `service ${t.state.toLowerCase()}`
  };
}

async function endToEnd() {
  const cfg = config.read();
  const host = (cfg.allowedOrigin || 'https://waterboyshockey.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const apiHost = host.startsWith('api.') ? host : `api.${host}`;
  const url = `https://${apiHost}/api/health`;
  const r = await fetchWithTimeout(url);
  return {
    label: 'Public reachability',
    state: r.ok ? 'ok' : 'down',
    url,
    detail: r.ok ? `${r.ms}ms` : (r.error || `HTTP ${r.status}`)
  };
}

async function videoFolder() {
  const cfg = config.read();
  if (!cfg.videoRoot) {
    return { label: 'Video folder', state: 'missing', detail: 'not configured' };
  }
  if (!fs.existsSync(cfg.videoRoot)) {
    return { label: 'Video folder', state: 'down', detail: `does not exist: ${cfg.videoRoot}` };
  }
  let count = 0;
  const exts = (cfg.videoExtensions || []).map(e => e.toLowerCase());
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) count++;
    }
  };
  walk(cfg.videoRoot, 0);
  return {
    label: 'Video folder',
    state: count > 0 ? 'ok' : 'warn',
    detail: `${count} video file${count === 1 ? '' : 's'} in ${cfg.videoRoot}`
  };
}

async function all() {
  const [local, tunnel, e2e, folder] = await Promise.all([
    localServer(),
    tunnelService(),
    endToEnd(),
    videoFolder()
  ]);
  const states = [local.state, tunnel.state, e2e.state, folder.state];
  let overall = 'ok';
  if (states.some(s => s === 'down' || s === 'missing')) overall = 'down';
  else if (states.some(s => s === 'warn')) overall = 'warn';
  return { overall, local, tunnel, e2e, folder, at: new Date().toISOString() };
}

module.exports = { all, localServer, tunnelService, endToEnd, videoFolder };
