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

function buildTree(config) {
  const { videoRoot, videoExtensions } = config;
  const exts = videoExtensions.map(x => x.toLowerCase());

  const divisions = listDirs(videoRoot).map(divName => {
    const divPath = path.join(videoRoot, divName);
    const seasons = listDirs(divPath).map(seasonName => {
      const seasonPath = path.join(divPath, seasonName);
      return {
        name: seasonName,
        type: 'season',
        path: `${divName}/${seasonName}`,
        children: listVideos(seasonPath, exts).map(v => ({
          ...v,
          path: `${divName}/${seasonName}/${v.name}`
        }))
      };
    });
    return {
      name: divName,
      type: 'division',
      path: divName,
      children: seasons
    };
  });

  return divisions;
}

module.exports = { buildTree };
