const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function hash(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  return { passwordHash };
}

function newJwtSecret() {
  return crypto.randomBytes(48).toString('hex');
}

module.exports = { hash, newJwtSecret };
