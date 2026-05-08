const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const FILES = {
  serverOut: 'server.out.log',
  serverErr: 'server.err.log',
  tunnelOut: 'cloudflared.out.log',
  tunnelErr: 'cloudflared.err.log'
};

function tail(name, lines = 80) {
  const filename = FILES[name];
  if (!filename) return { error: `unknown log: ${name}` };
  const file = path.join(paths.logsDir(), filename);
  if (!fs.existsSync(file)) return { lines: [], file, missing: true };
  const max = 256 * 1024;
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - max);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const all = buf.toString('utf8').split(/\r?\n/);
  return { lines: all.slice(-lines), file };
}

function recentErrors(lines = 20) {
  const out = [];
  for (const key of ['serverErr', 'tunnelErr']) {
    const t = tail(key, lines);
    for (const line of t.lines) {
      if (line.trim()) out.push({ source: key, line });
    }
  }
  return out.slice(-lines);
}

module.exports = { FILES, tail, recentErrors };
