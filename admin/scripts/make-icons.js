#!/usr/bin/env node
// Synthesize the tray-state ICOs and the app icon using Jimp + to-ico.
// The generated ICOs are committed under admin/build/, so the build itself
// doesn't need this script. It's only run when the icon design changes.
//
// jimp and to-ico are NOT in package.json devDeps — they pull in legacy
// transitive deps with security advisories that we don't want in the
// project's audit baseline. To regenerate icons:
//   npm install --no-save jimp@^0.22.10 to-ico@^1.1.5
//   npm run icons

const path = require('path');
const fs = require('fs');

let Jimp, toIco;
try {
  Jimp = require('jimp');
  toIco = require('to-ico');
} catch (err) {
  console.error('Missing optional deps. To regenerate icons, run:');
  console.error('  npm install --no-save jimp@^0.22.10 to-ico@^1.1.5');
  console.error('  npm run icons');
  process.exit(1);
}

const BUILD_DIR = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(BUILD_DIR, { recursive: true });

const TRAY_COLORS = {
  ok:      [0x10, 0xb9, 0x81],
  warn:    [0xf5, 0x9e, 0x0b],
  down:    [0xef, 0x44, 0x44],
  unknown: [0xb6, 0xc2, 0xe0]
};

const APP_BLUE   = [0x00, 0x20, 0x5b];
const APP_ORANGE = [0xff, 0x4c, 0x00];

function rgba(r, g, b, a = 0xff) {
  return Jimp.rgbaToInt(r, g, b, a);
}

async function makeCirclePng(size, [r, g, b], { ringColor = null } = {}) {
  const img = new Jimp(size, size, rgba(0, 0, 0, 0));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  const ring = ringColor ? rgba(...ringColor) : null;
  const fill = rgba(r, g, b);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= radius) {
        const onRing = ring && d > radius - Math.max(1, size * 0.06);
        img.setPixelColor(onRing ? ring : fill, x, y);
      }
    }
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

async function makeAppIcon(size) {
  // Blue circle, orange ring, white "W" centered.
  const img = new Jimp(size, size, rgba(0, 0, 0, 0));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  const ringWidth = Math.max(2, size * 0.06);
  const ring = rgba(...APP_ORANGE);
  const fill = rgba(...APP_BLUE);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= radius) {
        img.setPixelColor(d > radius - ringWidth ? ring : fill, x, y);
      }
    }
  }
  if (size >= 64) {
    const fontKey = size >= 128 ? Jimp.FONT_SANS_64_WHITE : Jimp.FONT_SANS_32_WHITE;
    const font = await Jimp.loadFont(fontKey);
    const text = 'W';
    const tw = Jimp.measureText(font, text);
    const th = Jimp.measureTextHeight(font, text, size);
    img.print(font, Math.round((size - tw) / 2), Math.round((size - th) / 2), text);
  }
  return img.getBufferAsync(Jimp.MIME_PNG);
}

async function writeIco(filename, pngBuffers) {
  const ico = await toIco(pngBuffers);
  const out = path.join(BUILD_DIR, filename);
  fs.writeFileSync(out, ico);
  console.log(`wrote ${out} (${ico.length} bytes)`);
}

(async () => {
  for (const [name, color] of Object.entries(TRAY_COLORS)) {
    const png16 = await makeCirclePng(16, color);
    const png32 = await makeCirclePng(32, color);
    await writeIco(`tray-${name}.ico`, [png16, png32]);
  }

  const png256 = await makeAppIcon(256);
  const png128 = await makeAppIcon(128);
  const png64  = await makeAppIcon(64);
  const png48  = await makeAppIcon(48);
  const png32  = await makeAppIcon(32);
  const png16  = await makeAppIcon(16);
  await writeIco('icon.ico', [png16, png32, png48, png64, png128, png256]);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
