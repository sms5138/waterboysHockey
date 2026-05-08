const { spawn } = require('child_process');

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout && child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr && child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function spawnDetached(cmd, args = [], opts = {}) {
  return spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore', ...opts });
}

async function which(cmd) {
  const isWin = process.platform === 'win32';
  const { code, stdout } = await run(isWin ? 'where' : 'which', [cmd]);
  if (code !== 0) return null;
  return stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || null;
}

module.exports = { run, spawnDetached, which };
