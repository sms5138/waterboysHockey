const path = require('path');
const fs = require('fs');
const { run, which } = require('./exec');
const paths = require('./paths');

const SERVER_SVC = 'WaterboysVideoServer';
const TUNNEL_SVC = 'WaterboysCloudflared';

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

async function install() {
  const nssm = await which('nssm');
  if (!nssm) return { ok: false, error: 'nssm not found. Install NSSM via winget first.' };
  const node = await which('node');
  if (!node) return { ok: false, error: 'node not found. Install Node.js LTS first.' };
  const cloudflared = await which('cloudflared');
  if (!cloudflared) return { ok: false, error: 'cloudflared not found. Install via winget first.' };

  fs.mkdirSync(paths.logsDir(), { recursive: true });
  const serverEntry = paths.serverEntry();
  const serverDir = paths.serverDir();
  const cfgPath = paths.configFile();
  const serverOut = path.join(paths.logsDir(), 'server.out.log');
  const serverErr = path.join(paths.logsDir(), 'server.err.log');
  const tunnelOut = path.join(paths.logsDir(), 'cloudflared.out.log');
  const tunnelErr = path.join(paths.logsDir(), 'cloudflared.err.log');

  const steps = [];
  const exec = async (label, args) => {
    const r = await run('nssm', args);
    steps.push({ label, code: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim() });
    return r.code === 0;
  };

  await exec('install server', ['install', SERVER_SVC, node, serverEntry]);
  await exec('server cwd',     ['set', SERVER_SVC, 'AppDirectory', serverDir]);
  await exec('server env',     ['set', SERVER_SVC, 'AppEnvironmentExtra', `WATERBOYS_CONFIG=${cfgPath}`]);
  await exec('server autostart', ['set', SERVER_SVC, 'Start', 'SERVICE_AUTO_START']);
  await exec('server stdout',  ['set', SERVER_SVC, 'AppStdout', serverOut]);
  await exec('server stderr',  ['set', SERVER_SVC, 'AppStderr', serverErr]);

  await exec('install tunnel',  ['install', TUNNEL_SVC, cloudflared, 'tunnel', 'run', 'waterboys']);
  await exec('tunnel autostart', ['set', TUNNEL_SVC, 'Start', 'SERVICE_AUTO_START']);
  await exec('tunnel stdout',   ['set', TUNNEL_SVC, 'AppStdout', tunnelOut]);
  await exec('tunnel stderr',   ['set', TUNNEL_SVC, 'AppStderr', tunnelErr]);

  return { ok: steps.every(s => s.code === 0), steps };
}

async function start(name) { return run('nssm', ['start', name]); }
async function stop(name)  { return run('nssm', ['stop', name]); }
async function restart(name) {
  await stop(name);
  return start(name);
}

async function uninstall() {
  await stop(SERVER_SVC);
  await stop(TUNNEL_SVC);
  const r1 = await run('nssm', ['remove', SERVER_SVC, 'confirm']);
  const r2 = await run('nssm', ['remove', TUNNEL_SVC, 'confirm']);
  return {
    ok: r1.code === 0 && r2.code === 0,
    server: r1,
    tunnel: r2
  };
}

module.exports = {
  SERVER_SVC, TUNNEL_SVC,
  status, install, start, stop, restart, uninstall
};
