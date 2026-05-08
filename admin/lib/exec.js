const { spawn } = require('child_process');

// Run a child process and resolve with { code, stdout, stderr, timedOut }.
//
// stdio defaults to ['ignore', 'pipe', 'pipe'] so the child can never block
// reading stdin — Node's default opens stdin as a pipe and leaves it open,
// and some Windows CLIs (cloudflared in particular) will hang reading from
// it under odd console conditions.
//
// Pass opts.timeoutMs to bound how long we'll wait. On timeout we SIGKILL the
// child and resolve with timedOut: true plus a sentinel stderr message.
function run(cmd, args = [], opts = {}) {
  const { timeoutMs, ...spawnOpts } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOpts
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch {}
      }, timeoutMs);
    }
    child.stdout && child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr && child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + err.message, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: timedOut ? -1 : code,
        stdout,
        stderr: timedOut ? stderr + `\n[killed after ${timeoutMs}ms timeout]` : stderr,
        timedOut
      });
    });
  });
}

function spawnDetached(cmd, args = [], opts = {}) {
  return spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore', ...opts });
}

async function which(cmd) {
  const isWin = process.platform === 'win32';
  const { code, stdout } = await run(isWin ? 'where' : 'which', [cmd], { timeoutMs: 5000 });
  if (code !== 0) return null;
  return stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || null;
}

module.exports = { run, spawnDetached, which };
