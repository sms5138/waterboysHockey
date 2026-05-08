#!/usr/bin/env node
// Increment package.json's patch version. Runs before every `npm run build`
// so successive test builds get distinct version numbers — visible in the
// installer filename, the "Add or Remove Programs" entry, and the dashboard
// topbar of the running app.

const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(pkg.version || '0.0.0');
if (!m) {
  console.error(`Cannot parse version: ${pkg.version}`);
  process.exit(1);
}
const [, major, minor, patch, suffix] = m;
const newVersion = `${major}.${minor}.${Number(patch) + 1}${suffix}`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`bump-version: ${pkg.name}@${newVersion}`);
