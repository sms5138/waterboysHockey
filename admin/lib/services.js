const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { run, which } = require('./exec');
const elevate = require('./elevate');
const paths = require('./paths');

const SERVER_SVC = 'WaterboysVideoServer';
const TUNNEL_SVC = 'WaterboysCloudflared';
const SERVICE_USER = 'WaterboysSvc';

async function nssmStatus(name) {
  const nssm = await which('nssm');
  if (!nssm) return { name, installed: false, state: 'unknown', error: 'nssm not on PATH' };
  const { code, stdout, stderr } = await run('nssm', ['status', name]);
  if (code !== 0) {
    return { name, installed: false, state: 'not-installed', error: (stderr || stdout).trim() };
  }
  return { name, installed: true, state: stdout.trim() };
}

async function status() {
  const [server, tunnel] = await Promise.all([nssmStatus(SERVER_SVC), nssmStatus(TUNNEL_SVC)]);
  return { server, tunnel };
}

// Read-only — Get-LocalUser doesn't require admin to query.
async function userExists(name) {
  if (process.platform !== 'win32') return false;
  const r = await run('powershell', ['-NoProfile', '-Command',
    `if (Get-LocalUser -Name '${name}' -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`
  ]);
  return r.stdout.trim() === 'yes';
}

async function getUserSid(name) {
  if (process.platform !== 'win32') return null;
  const r = await run('powershell', ['-NoProfile', '-Command',
    `(Get-LocalUser -Name '${name}' -ErrorAction SilentlyContinue).SID.Value`
  ]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

// Create or reset the service account, then bind both NSSM services to it,
// in a single elevated PowerShell session (one UAC prompt).
//
// NSSM's `set ... ObjectName` automatically grants SeServiceLogonRight via
// LsaAddAccountRights, so we don't need to wrestle secedit on Home edition.
async function ensureServiceUserAndBind() {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'service account creation only applies on Windows' };
  }
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not on PATH' };

  const password = crypto.randomBytes(32).toString('hex'); // 64 chars [0-9a-f] — safe in PS single quotes
  const exists = await userExists(SERVICE_USER);

  // Inline PowerShell that creates or resets the user.
  const userScript = exists
    ? [
        `$pwd = ConvertTo-SecureString '${password}' -AsPlainText -Force`,
        `Set-LocalUser -Name '${SERVICE_USER}' -Password $pwd`
      ].join('; ')
    : [
        `$pwd = ConvertTo-SecureString '${password}' -AsPlainText -Force`,
        `New-LocalUser -Name '${SERVICE_USER}' -Password $pwd \``,
        `  -FullName 'Waterboys Video Server Service' \``,
        `  -Description 'Runs Waterboys services; no interactive logon' \``,
        `  -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null`,
        `Remove-LocalGroupMember -Group 'Users' -Member '${SERVICE_USER}' -ErrorAction SilentlyContinue`
      ].join('; ');

  const r = await elevate.runElevated([
    {
      label: exists ? `reset ${SERVICE_USER} password` : `create ${SERVICE_USER}`,
      cmd: 'powershell',
      args: ['-NoProfile', '-Command', userScript]
    },
    { label: 'server objectname', cmd: nssm, args: ['set', SERVER_SVC, 'ObjectName', `.\\${SERVICE_USER}`, password] },
    { label: 'tunnel objectname', cmd: nssm, args: ['set', TUNNEL_SVC, 'ObjectName', `.\\${SERVICE_USER}`, password] }
  ]);

  if (!r.ok) return r;

  const sid = await getUserSid(SERVICE_USER);
  return { ok: true, name: SERVICE_USER, sid, steps: r.steps };
}

async function removeServiceUser() {
  if (process.platform !== 'win32') return { ok: true };
  return elevate.runElevated([
    {
      label: `remove ${SERVICE_USER}`,
      cmd: 'powershell',
      args: ['-NoProfile', '-Command', `Remove-LocalUser -Name '${SERVICE_USER}' -ErrorAction SilentlyContinue`]
    }
  ]);
}

// Install both NSSM services in a single UAC prompt.
async function install() {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not found. Install NSSM first.' };
  const node = await which('node');
  if (!node) return { ok: false, error: 'node not found. Install Node.js LTS first.' };
  const cloudflared = await which('cloudflared');
  if (!cloudflared) return { ok: false, error: 'cloudflared not found.' };

  fs.mkdirSync(paths.logsDir(), { recursive: true });
  const serverEntry = paths.serverEntry();
  const serverDir   = paths.serverDir();
  const cfgPath     = paths.configFile();
  const serverOut   = path.join(paths.logsDir(), 'server.out.log');
  const serverErr   = path.join(paths.logsDir(), 'server.err.log');
  const tunnelOut   = path.join(paths.logsDir(), 'cloudflared.out.log');
  const tunnelErr   = path.join(paths.logsDir(), 'cloudflared.err.log');

  const steps = [
    // Idempotency: stop & remove any existing services first. These are
    // expected to fail on a clean install (services don't exist yet);
    // allowFail keeps the overall result `ok` regardless.
    { label: 'pre-stop server',          cmd: nssm, args: ['stop', SERVER_SVC],   allowFail: true },
    { label: 'pre-remove server',        cmd: nssm, args: ['remove', SERVER_SVC, 'confirm'], allowFail: true },
    { label: 'pre-stop tunnel',          cmd: nssm, args: ['stop', TUNNEL_SVC],   allowFail: true },
    { label: 'pre-remove tunnel',        cmd: nssm, args: ['remove', TUNNEL_SVC, 'confirm'], allowFail: true },

    { label: 'install server',           cmd: nssm, args: ['install', SERVER_SVC, node, serverEntry] },
    { label: 'server cwd',               cmd: nssm, args: ['set', SERVER_SVC, 'AppDirectory', serverDir] },
    { label: 'server env',               cmd: nssm, args: ['set', SERVER_SVC, 'AppEnvironmentExtra', `WATERBOYS_CONFIG=${cfgPath}`] },
    { label: 'server autostart',         cmd: nssm, args: ['set', SERVER_SVC, 'Start', 'SERVICE_AUTO_START'] },
    { label: 'server stdout',            cmd: nssm, args: ['set', SERVER_SVC, 'AppStdout', serverOut] },
    { label: 'server stderr',            cmd: nssm, args: ['set', SERVER_SVC, 'AppStderr', serverErr] },
    { label: 'server restart on fail',   cmd: nssm, args: ['set', SERVER_SVC, 'AppExit', 'Default', 'Restart'] },
    { label: 'server restart delay',     cmd: nssm, args: ['set', SERVER_SVC, 'AppRestartDelay', '5000'] },
    { label: 'install tunnel',           cmd: nssm, args: ['install', TUNNEL_SVC, cloudflared, 'tunnel', 'run', 'waterboys'] },
    { label: 'tunnel autostart',         cmd: nssm, args: ['set', TUNNEL_SVC, 'Start', 'SERVICE_AUTO_START'] },
    { label: 'tunnel stdout',            cmd: nssm, args: ['set', TUNNEL_SVC, 'AppStdout', tunnelOut] },
    { label: 'tunnel stderr',            cmd: nssm, args: ['set', TUNNEL_SVC, 'AppStderr', tunnelErr] },
    { label: 'tunnel restart on fail',   cmd: nssm, args: ['set', TUNNEL_SVC, 'AppExit', 'Default', 'Restart'] },
    { label: 'tunnel restart delay',     cmd: nssm, args: ['set', TUNNEL_SVC, 'AppRestartDelay', '5000'] },

    // Start both services in the same elevated batch so the user only sees
    // one UAC prompt for the whole "install + start" flow. allowFail because
    // a startup error shouldn't undo the install — the user can troubleshoot
    // with the dashboard's Restart buttons.
    { label: 'start server',             cmd: nssm, args: ['start', SERVER_SVC], allowFail: true },
    { label: 'start tunnel',             cmd: nssm, args: ['start', TUNNEL_SVC], allowFail: true }
  ];

  return elevate.runElevated(steps);
}

async function start(name) {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not on PATH' };
  return elevate.runElevated([
    { label: `start ${name}`, cmd: nssm, args: ['start', name] }
  ]);
}

async function stop(name) {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not on PATH' };
  return elevate.runElevated([
    { label: `stop ${name}`, cmd: nssm, args: ['stop', name] }
  ]);
}

async function restart(name) {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not on PATH' };
  return elevate.runElevated([
    { label: `stop ${name}`,  cmd: nssm, args: ['stop', name] },
    { label: `start ${name}`, cmd: nssm, args: ['start', name] }
  ]);
}

async function uninstall() {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not on PATH' };
  // Stops are allowFail — services may already be stopped or not installed.
  return elevate.runElevated([
    { label: `stop ${SERVER_SVC}`,   cmd: nssm, args: ['stop', SERVER_SVC],   allowFail: true },
    { label: `stop ${TUNNEL_SVC}`,   cmd: nssm, args: ['stop', TUNNEL_SVC],   allowFail: true },
    { label: `remove ${SERVER_SVC}`, cmd: nssm, args: ['remove', SERVER_SVC, 'confirm'], allowFail: true },
    { label: `remove ${TUNNEL_SVC}`, cmd: nssm, args: ['remove', TUNNEL_SVC, 'confirm'], allowFail: true }
  ]);
}

module.exports = {
  SERVER_SVC, TUNNEL_SVC, SERVICE_USER,
  status, install, start, stop, restart, uninstall,
  ensureServiceUserAndBind, removeServiceUser, getUserSid, userExists
};
