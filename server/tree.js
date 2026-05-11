const fs = require('fs');
const path = require('path');

const HIDDEN = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function listDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !HIDDEN.has(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function listVideos(dir, allowedExts) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && !HIDDEN.has(e.name))
    .filter(e => allowedExts.includes(path.extname(e.name).toLowerCase()))
    .map(e => {
      const full = path.join(dir, e.name);
      let stat;
      try { stat = fs.statSync(full); } catch { return null; }
      return {
        name: e.name,
        type: 'video',
        size: stat.size,
        modified: stat.mtime.toISOString()
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Recursively walks `levels.length` directory levels under `videoRoot`, then
// lists videos at the leaf. Each intermediate node's `type` is taken from
// `levels[depth]` (lowercased), so the frontend can label panes generically.
function walk(dir, relPath, levels, depth, exts) {
  if (depth >= levels.length) {
    return listVideos(dir, exts).map(v => ({
      ...v,
      path: relPath ? `${relPath}/${v.name}` : v.name
    }));
  }
  const levelType = String(levels[depth]).toLowerCase();
  return listDirs(dir).map(name => {
    const childRel = relPath ? `${relPath}/${name}` : name;
    return {
      name,
      type: levelType,
      path: childRel,
      children: walk(path.join(dir, name), childRel, levels, depth + 1, exts)
    };
  });
}

function buildTree(library, videoExtensions) {
  const exts = videoExtensions.map(x => x.toLowerCase());
  const levels = Array.isArray(library.levels) && library.levels.length
    ? library.levels
    : ['Division', 'Season'];
  return walk(library.videoRoot, '', levels, 0, exts);
}

module.exports = { buildTree };
