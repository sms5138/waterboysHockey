const { run, which } = require('./exec');

const TOOLS = {
  node:        { name: 'Node.js',           winget: 'OpenJS.NodeJS.LTS' },
  cloudflared: { name: 'Cloudflare Tunnel', winget: 'Cloudflare.cloudflared' },
  nssm:        { name: 'NSSM',              winget: 'NSSM.NSSM' }
};

async function check() {
  const out = {};
  for (const [key, meta] of Object.entries(TOOLS)) {
    const path = await which(key);
    let version = null;
    if (path) {
      const args = key === 'nssm' ? ['version'] : ['--version'];
      const { stdout } = await run(key, args);
      version = (stdout || '').trim().split(/\r?\n/)[0] || null;
    }
    out[key] = { name: meta.name, installed: Boolean(path), path, version, winget: meta.winget };
  }
  return out;
}

async function install(key) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Prereq install is only supported on Windows.' };
  }
  const meta = TOOLS[key];
  if (!meta) return { ok: false, error: `Unknown tool: ${key}` };
  const { code, stdout, stderr } = await run('winget', [
    'install', '--id', meta.winget, '--silent', '--accept-package-agreements', '--accept-source-agreements'
  ]);
  return { ok: code === 0, code, stdout, stderr };
}

module.exports = { TOOLS, check, install };
