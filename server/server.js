const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { issueToken, verifyPassword, requireAuth } = require('./auth');
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

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '16kb' }));
app.use(cors({
  origin: config.allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
}));

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  const ok = await verifyPassword(password, config.passwordHash);
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  res.json(issueToken(config));
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

app.listen(config.port, () => {
  console.log(`Waterboys video server listening on http://localhost:${config.port}`);
  console.log(`Serving videos from: ${config.videoRoot}`);
  console.log(`Allowed origin: ${config.allowedOrigin}`);
});
