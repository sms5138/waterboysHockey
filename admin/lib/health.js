const fs = require('fs');
const path = require('path');
const config = require('./config');
const services = require('./services');
const firewall = require('./firewall');

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

function countVideos(root, exts) {
  let count = 0;
  const lower = exts.map(e => e.toLowerCase());
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && lower.includes(path.extname(e.name).toLowerCase())) count++;
    }
  };
  walk(root, 0);
  return count;
}

async function videoFolders() {
  const cfg = config.read();
  return Object.entries(cfg.libraries).map(([key, lib]) => {
    const label = `${lib.label} videos`;
    if (!lib.videoRoot) {
      return { label, state: 'missing', detail: 'not configured', libraryKey: key };
    }
    if (!fs.existsSync(lib.videoRoot)) {
      return { label, state: 'down', detail: `does not exist: ${lib.videoRoot}`, libraryKey: key };
    }
    const count = countVideos(lib.videoRoot, cfg.videoExtensions || []);
    return {
      label,
      state: count > 0 ? 'ok' : 'warn',
      detail: `${count} video file${count === 1 ? '' : 's'} in ${lib.videoRoot}`,
      libraryKey: key
    };
  });
}

async function hardeningCheck() {
  const cfg = config.read();
  const h = cfg.hardening || {};
  let firewallOk = false;
  try {
    const fw = await firewall.rulesPresent();
    firewallOk = fw.node && fw.loopback && fw.cloudflared && fw.cloudflaredLan;
  } catch {}
  const acctOk = Boolean(h.serviceAccountAppliedAt);
  const aclsOk = Boolean(h.aclsAppliedAt);
  const all = acctOk && aclsOk && firewallOk;
  const partial = acctOk || aclsOk || firewallOk;
  const missing = [];
  if (!acctOk)     missing.push('service account');
  if (!aclsOk)     missing.push('folder ACLs');
  if (!firewallOk) missing.push('firewall rules');
  return {
    label: 'Hardening',
    state: all ? 'ok' : (partial ? 'warn' : 'missing'),
    detail: all ? 'service account, ACLs, firewall all applied'
                : `not applied: ${missing.join(', ')}`
  };
}

async function all() {
  const [local, tunnel, e2e, folders, hardening] = await Promise.all([
    localServer(),
    tunnelService(),
    endToEnd(),
    videoFolders(),
    hardeningCheck()
  ]);
  const folderStates = folders.map(f => f.state);
  const states = [local.state, tunnel.state, e2e.state, ...folderStates, hardening.state];
  let overall = 'ok';
  if (states.some(s => s === 'down')) overall = 'down';
  else if (states.some(s => s === 'warn' || s === 'missing')) overall = 'warn';
  return { overall, local, tunnel, e2e, folders, hardening, at: new Date().toISOString() };
}

module.exports = { all, localServer, tunnelService, endToEnd, videoFolders, hardeningCheck };
