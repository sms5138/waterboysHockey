const fs = require('fs');
const paths = require('./paths');

const LIBRARY_PRESETS = {
  waterboys: { label: 'Waterboys', levels: ['Division', 'Season'] },
  youth:     { label: 'Youth League', levels: ['League', 'Team', 'Season'] }
};

function defaultLibraries() {
  const out = {};
  for (const [key, preset] of Object.entries(LIBRARY_PRESETS)) {
    out[key] = { label: preset.label, levels: [...preset.levels], videoRoot: '', passwordHash: '' };
  }
  return out;
}

const DEFAULTS = {
  port: 8088,
  jwtSecret: '',
  allowedOrigin: 'https://waterboyshockey.com',
  cookieDomain: '',
  videoExtensions: ['.mp4', '.mov', '.mkv', '.m4v', '.webm'],
  tokenTtlHours: 12,
  libraries: defaultLibraries(),
  hardening: {
    serviceAccount: '',
    serviceAccountAppliedAt: null,
    aclsAppliedAt: null,
    firewallAppliedAt: null,
    cloudflareAccessAcknowledged: false
  }
};

function ensureDir() {
  fs.mkdirSync(paths.configDir(), { recursive: true });
  fs.mkdirSync(paths.logsDir(), { recursive: true });
}

function exists() {
  return fs.existsSync(paths.configFile());
}

// Pre-dual-library configs had `videoRoot` and `passwordHash` at the top level.
// Fold them into libraries.waterboys with the original Division/Season layout.
function migrate(cfg) {
  if (cfg.libraries && Object.keys(cfg.libraries).length > 0) return cfg;
  if (!cfg.videoRoot && !cfg.passwordHash) return cfg;
  const out = { ...cfg };
  out.libraries = {
    waterboys: {
      label: 'Waterboys',
      videoRoot: cfg.videoRoot || '',
      passwordHash: cfg.passwordHash || '',
      levels: ['Division', 'Season']
    }
  };
  delete out.videoRoot;
  delete out.passwordHash;
  return out;
}

function withDefaultLibraries(cfg) {
  const libs = defaultLibraries();
  for (const [key, lib] of Object.entries(cfg.libraries || {})) {
    libs[key] = { ...libs[key], ...lib };
    if (!libs[key].label && LIBRARY_PRESETS[key]) libs[key].label = LIBRARY_PRESETS[key].label;
    if (!Array.isArray(libs[key].levels) || libs[key].levels.length === 0) {
      libs[key].levels = LIBRARY_PRESETS[key] ? [...LIBRARY_PRESETS[key].levels] : ['Division', 'Season'];
    }
  }
  return { ...cfg, libraries: libs };
}

function read() {
  if (!exists()) return { ...DEFAULTS, libraries: defaultLibraries() };
  const raw = fs.readFileSync(paths.configFile(), 'utf8');
  const parsed = JSON.parse(raw);
  const migrated = migrate(parsed);
  const withDefaults = { ...DEFAULTS, ...migrated };
  return withDefaultLibraries(withDefaults);
}

// Deep-merge libraries so writing a single library's password (or videoRoot)
// doesn't clobber the other library's settings.
function write(partial) {
  ensureDir();
  const current = read();
  const merged = { ...current, ...partial };
  if (partial.libraries) {
    merged.libraries = { ...current.libraries };
    for (const [key, lib] of Object.entries(partial.libraries)) {
      merged.libraries[key] = { ...(current.libraries[key] || {}), ...lib };
    }
  }
  fs.writeFileSync(paths.configFile(), JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  return merged;
}

function summary() {
  const cfg = read();
  const libraries = {};
  for (const [key, lib] of Object.entries(cfg.libraries)) {
    libraries[key] = {
      label: lib.label,
      levels: lib.levels,
      videoRoot: lib.videoRoot,
      hasPassword: Boolean(lib.passwordHash && lib.passwordHash.startsWith('$2')),
      configured: Boolean(lib.videoRoot && lib.passwordHash)
    };
  }
  const anyPassword = Object.values(libraries).some(l => l.hasPassword);
  return {
    exists: exists(),
    port: cfg.port,
    allowedOrigin: cfg.allowedOrigin,
    hasJwtSecret: Boolean(cfg.jwtSecret && cfg.jwtSecret.length >= 32),
    hasPassword: anyPassword,
    videoExtensions: cfg.videoExtensions,
    libraries,
    configPath: paths.configFile()
  };
}

module.exports = { DEFAULTS, LIBRARY_PRESETS, exists, read, write, summary, ensureDir };
