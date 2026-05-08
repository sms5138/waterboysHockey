const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const {
  issueToken,
  verifyPassword,
  requireAuth,
  setSessionCookie,
  clearSessionCookie
} = require('./auth');
const { buildTree } = require('./tree');
const { sendFile } = require('./stream');

const configPath = process.env.WATERBOYS_CONFIG || path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`config.json not found at ${configPath}. Run the Waterboys setup wizard, or copy config.example.json to config.json.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

for (const key of ['videoRoot', 'port', 'passwordHash', 'jwtSecret', 'allowedOrigin', 'videoExtensions']) {
  if (!config[key]) {
    console.error(`config.json is missing required key: ${key}`);
    process.exit(1);
  }
}
if (!fs.existsSync(config.videoRoot)) {
  console.error(`videoRoot does not exist: ${config.videoRoot}`);
  process.exit(1);
}

const app = express();

// cloudflared sits on loopback in front of us; trust its X-Forwarded-For
// so per-IP rate limits and access logs see the real client, not 127.0.0.1.
app.set('trust proxy', 'loopback');

function clientIp(req) {
  return req.headers['cf-connecting-ip']
      || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.ip;
}
app.use((req, _res, next) => { req.clientIp = clientIp(req); next(); });

// Minimal access log: one JSON line per response. NSSM redirects stdout to
// server.out.log so the dashboard can surface 401/403/429 lines.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const line = {
      t: new Date().toISOString(),
      ip: req.clientIp,
      m: req.method,
      p: req.path,
      s: res.statusCode,
      ms: Date.now() - start,
      ua: (req.headers['user-agent'] || '').slice(0, 120)
    };
    console.log(JSON.stringify(line));
  });
  next();
});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '16kb' }));
app.use(cors({
  origin: config.allowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
}));

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.clientIp || 'unknown'
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.clientIp || 'unknown',
  // Don't burn the budget on Range continuations for a single video stream.
  skip: (req) => Boolean(req.headers.range)
});
app.use('/api/', apiLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  const ok = await verifyPassword(password, config.passwordHash);
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  const { token, expiresAt, ttlSeconds } = issueToken(config);
  setSessionCookie(res, token, ttlSeconds, config);
  res.json({ expiresAt });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res, config);
  res.json({ ok: true });
});

app.get('/api/tree', requireAuth(config), (req, res) => {
  res.json({ root: path.basename(config.videoRoot), children: buildTree(config) });
});

app.get('/api/file', requireAuth(config), (req, res) => {
  sendFile(req, res, config, { asAttachment: false });
});

app.get('/api/download', requireAuth(config), (req, res) => {
  sendFile(req, res, config, { asAttachment: true });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Bind to loopback only — cloudflared runs on the same box and reaches us
// over 127.0.0.1, so 0.0.0.0 binding adds no value and would expose the
// server to anyone else on the LAN.
app.listen(config.port, '127.0.0.1', () => {
  console.log(`Waterboys video server listening on http://127.0.0.1:${config.port}`);
  console.log(`Serving videos from: ${config.videoRoot}`);
  console.log(`Allowed origin: ${config.allowedOrigin}`);
});
