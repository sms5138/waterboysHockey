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

// Apply read-only-on-videoRoot, read-only-on-config, modify-on-logs, deny-on-Plex.
// All icacls calls run inside one elevated PowerShell session (one UAC prompt).
async function applyAcls({ videoRoot, configDir, logsDir, userName }) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'ACLs only apply on Windows', steps: [] };
  }
  if (!userName) throw new Error('userName is required');
  if (!videoRoot || !fs.existsSync(videoRoot)) {
    return { ok: false, error: `videoRoot does not exist: ${videoRoot}`, steps: [] };
  }

  const calls = [];
  calls.push({ label: `grant ${userName} RX on videoRoot`, cmd: 'icacls', args: [videoRoot, '/grant:r', `${userName}:(OI)(CI)(RX)`] });

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

  if (process.env.USERPROFILE && fs.existsSync(process.env.USERPROFILE)) {
    calls.push({ label: `deny ${userName} on USERPROFILE`, cmd: 'icacls', args: [process.env.USERPROFILE, '/deny', `${userName}:(OI)(CI)(F)`] });
  }

  return elevate.runElevated(calls);
}

async function removeAcls({ videoRoot, configDir, logsDir, userName }) {
  if (process.platform !== 'win32') return { ok: true, steps: [] };
  const targets = [videoRoot, configDir, logsDir, ...plexCandidates(), process.env.USERPROFILE]
    .filter(p => p && fs.existsSync(p));
  const calls = [];
  for (const p of targets) {
    calls.push({ label: `remove grants on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/remove:g', userName] });
    calls.push({ label: `remove denies on ${path.basename(p)}`, cmd: 'icacls', args: [p, '/remove:d', userName] });
  }
  return elevate.runElevated(calls);
}

module.exports = { applyAcls, removeAcls, plexCandidates };
