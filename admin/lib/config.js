const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DEFAULTS = {
  videoRoot: '',
  port: 8088,
  passwordHash: '',
  jwtSecret: '',
  allowedOrigin: 'https://waterboyshockey.com',
  videoExtensions: ['.mp4', '.mov', '.mkv', '.m4v', '.webm'],
  tokenTtlHours: 12
};

function ensureDir() {
  fs.mkdirSync(paths.configDir(), { recursive: true });
  fs.mkdirSync(paths.logsDir(), { recursive: true });
}

function exists() {
  return fs.existsSync(paths.configFile());
}

function read() {
  if (!exists()) return { ...DEFAULTS };
  const raw = fs.readFileSync(paths.configFile(), 'utf8');
  return { ...DEFAULTS, ...JSON.parse(raw) };
}

function write(partial) {
  ensureDir();
  const merged = { ...read(), ...partial };
  fs.writeFileSync(paths.configFile(), JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  return merged;
}

function summary() {
  const cfg = read();
  return {
    exists: exists(),
    videoRoot: cfg.videoRoot,
    port: cfg.port,
    allowedOrigin: cfg.allowedOrigin,
    hasPassword: Boolean(cfg.passwordHash && cfg.passwordHash.startsWith('$2')),
    hasJwtSecret: Boolean(cfg.jwtSecret && cfg.jwtSecret.length >= 32),
    videoExtensions: cfg.videoExtensions,
    configPath: paths.configFile()
  };
}

module.exports = { DEFAULTS, exists, read, write, summary, ensureDir };
