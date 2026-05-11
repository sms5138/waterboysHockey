const fs = require('fs');
const path = require('path');
const elevate = require('./elevate');

// Locations Plex Media Server stores its database, transcodes, and metadata.
// Listed both for user-mode and service-mode installs since either is possible
// on consumer Windows.
const PLEX_PATHS_RELATIVE = [
  'Plex Media Server',
  'Plex',
  'Plex Media Player'
];

function plexCandidates() {
  const dirs = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.PROGRAMDATA,
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean);
  const out = [];
  for (const base of dirs) {
    for (const rel of PLEX_PATHS_RELATIVE) {
      out.push(path.join(base, rel));
    }
  }
  return out;
}

// User-data subdirs we want to deny WaterboysSvc on. We NO LONGER deny on
// the whole USERPROFILE because that also blocks AppData where the Electron
// app's binary, node.exe, and the cloudflared cert live — and the service
// principal needs to read those to function.
function userDataCandidates() {
  const profile = process.env.USERPROFILE;
  if (!profile) return [];
  return [
    'Documents',
    'Desktop',
    'Downloads',
    'Pictures',
    'Videos',
    'Music',
    'OneDrive',
    'OneDrive - Personal',
    'Dropbox'
  ].map(rel => path.join(profile, rel));
}

// Apply read-only on each library's videoRoot, read-only on config, modify on
// logs, deny on Plex. All icacls calls run inside one elevated PowerShell
// session (one UAC prompt).
async function applyAcls({ videoRoots, configDir, logsDir, userName }) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'ACLs only apply on Windows', steps: [] };
  }
  if (!userName) throw new Error('userName is required');
  const roots = (Array.isArray(videoRoots) ? videoRoots : [videoRoots]).filter(Boolean);
  if (roots.length === 0) {
    return { ok: false, error: 'no video roots configured', steps: [] };
  }
  for (const r of roots) {
    if (!fs.existsSync(r)) {
      return { ok: false, error: `videoRoot does not exist: ${r}`, steps: [] };
    }
  }

  const calls = [];
  for (const root of roots) {
    calls.push({ label: `grant ${userName} RX on ${path.basename(root)}`, cmd: 'icacls', args: [root, '/grant:r', `${userName}:(OI)(CI)(RX)`] });
  }

  calls.push({ label: `grant ${userName} RX on configDir`, cmd: 'icacls', args: [configDir, '/grant:r', `${userName}:(OI)(CI)(RX)`] });
  const cfgFile = path.join(configDir, 'config.json');
  if (fs.existsSync(cfgFile)) {
    calls.push({ label: `grant ${userName} R on config.json`, cmd: 'icacls', args: [cfgFile, '/grant:r', `${userName}:(R)`] });
  }
  if (fs.existsSync(logsDir)) {
    calls.push({ label: `grant ${userName} M on logs`, cmd: 'icacls', args: [logsDir, '/grant:r', `${userName}:(OI)(CI)(M)`] });
  }

  // Hard-deny on every Plex path that exists. Deny ACEs win over inherited allows.
  for (const p of plexCandidates()) {
    if (fs.existsSync(p)) {
      calls.push({ label: `deny ${userName} on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/deny', `${userName}:(OI)(CI)(F)`] });
    }
  }

  // Deny on each user-data subdir that exists. Deliberately scoped — we used
  // to deny on the whole USERPROFILE but that blocked AppData and broke the
  // service (it couldn't read its own bundled node.exe / server.js, and
  // cloudflared couldn't reach the cert in ~/.cloudflared).
  for (const p of userDataCandidates()) {
    if (fs.existsSync(p)) {
      calls.push({ label: `deny ${userName} on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/deny', `${userName}:(OI)(CI)(F)`] });
    }
  }

  return elevate.runElevated(calls);
}

async function removeAcls({ videoRoots, configDir, logsDir, userName }) {
  if (process.platform !== 'win32') return { ok: true, steps: [] };
  const roots = Array.isArray(videoRoots) ? videoRoots : [videoRoots];
  const targets = [...roots, configDir, logsDir, ...plexCandidates(), ...userDataCandidates()]
    .filter(p => p && fs.existsSync(p));
  const calls = [];
  for (const p of targets) {
    calls.push({ label: `remove grants on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/remove:g', userName] });
    calls.push({ label: `remove denies on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/remove:d', userName] });
  }
  return elevate.runElevated(calls);
}

module.exports = { applyAcls, removeAcls, plexCandidates };
