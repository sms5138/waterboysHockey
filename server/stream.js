const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

function resolveSafe(videoRoot, requested) {
  if (typeof requested !== 'string' || requested.length === 0) return null;
  if (requested.includes('\0')) return null;

  const root = path.resolve(videoRoot);
  const target = path.resolve(root, requested);

  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function isAllowedExt(file, allowedExts) {
  return allowedExts.includes(path.extname(file).toLowerCase());
}

function sendFile(req, res, videoRoot, videoExtensions, { asAttachment }) {
  const requested = req.query.path;
  const full = resolveSafe(videoRoot, requested);
  if (!full) return res.status(403).json({ error: 'invalid path' });
  if (!isAllowedExt(full, videoExtensions.map(e => e.toLowerCase()))) {
    return res.status(403).json({ error: 'file type not allowed' });
  }

  let stat;
  try { stat = fs.statSync(full); } catch { return res.status(404).json({ error: 'not found' }); }
  if (!stat.isFile()) return res.status(404).json({ error: 'not found' });

  const total = stat.size;
  const contentType = mime.lookup(full) || 'application/octet-stream';
  const filename = path.basename(full);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  if (asAttachment) {
    const safe = filename.replace(/"/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  }

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', total);
    return fs.createReadStream(full).pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${total}`);
    return res.end();
  }
  let start = match[1] === '' ? null : parseInt(match[1], 10);
  let end = match[2] === '' ? null : parseInt(match[2], 10);

  if (start === null && end !== null) {
    start = Math.max(0, total - end);
    end = total - 1;
  } else {
    if (start === null) start = 0;
    if (end === null) end = total - 1;
  }

  if (start > end || start >= total) {
    res.status(416).setHeader('Content-Range', `bytes */${total}`);
    return res.end();
  }
  end = Math.min(end, total - 1);

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(full, { start, end }).pipe(res);
}

module.exports = { sendFile };
