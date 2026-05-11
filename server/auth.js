const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'waterboys_session';

function issueToken(config, libraryKey) {
  const ttlSeconds = (config.tokenTtlHours || 12) * 3600;
  const token = jwt.sign({ scope: 'team', library: libraryKey }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds
  });
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return { token, expiresAt, ttlSeconds };
}

async function verifyPassword(submitted, hash) {
  if (typeof submitted !== 'string' || submitted.length === 0) return false;
  if (typeof hash !== 'string' || !hash.startsWith('$2')) return false;
  return bcrypt.compare(submitted, hash);
}

function buildCookie(value, ttlSeconds, config) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Path=/api',
    `Max-Age=${ttlSeconds}`
  ];
  if (config.cookieDomain) parts.push(`Domain=${config.cookieDomain}`);
  return parts.join('; ');
}

function setSessionCookie(res, token, ttlSeconds, config) {
  res.setHeader('Set-Cookie', buildCookie(token, ttlSeconds, config));
}

function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', buildCookie('', 0, config));
}

function readCookieToken(req) {
  const header = req.headers.cookie || '';
  const re = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`);
  const m = re.exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

function requireAuth(config) {
  return (req, res, next) => {
    let token = readCookieToken(req);
    if (!token) {
      const header = req.headers.authorization || '';
      if (header.startsWith('Bearer ')) token = header.slice(7);
    }
    if (!token) return res.status(401).json({ error: 'missing token' });

    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }

    // Legacy tokens (issued before dual-library) have no library claim — treat
    // them as the Waterboys session for one TTL cycle so existing logins don't
    // bounce out on first deploy.
    const libraryKey = claims.library || 'waterboys';
    const library = config.libraries && config.libraries[libraryKey];
    if (!library) return res.status(401).json({ error: 'unknown library' });

    req.libraryKey = libraryKey;
    req.library = library;
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  issueToken,
  verifyPassword,
  requireAuth,
  setSessionCookie,
  clearSessionCookie
};
