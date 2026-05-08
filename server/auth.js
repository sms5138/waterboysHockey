const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function issueToken(config) {
  const ttlSeconds = (config.tokenTtlHours || 12) * 3600;
  const token = jwt.sign({ scope: 'team' }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds
  });
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return { token, expiresAt };
}

async function verifyPassword(submitted, hash) {
  if (typeof submitted !== 'string' || submitted.length === 0) return false;
  if (typeof hash !== 'string' || !hash.startsWith('$2')) return false;
  return bcrypt.compare(submitted, hash);
}

function requireAuth(config) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer || req.query.token;
    if (!token) return res.status(401).json({ error: 'missing token' });

    try {
      jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      next();
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  };
}

module.exports = { issueToken, verifyPassword, requireAuth };
