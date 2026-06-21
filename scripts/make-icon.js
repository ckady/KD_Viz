'use strict';
// Generates build/icon.icns from an SVG drawn here (concentric signal orbs on a
// dark rounded square — echoes the Pulse mode). Run: npm run make-icon
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SIZE = 1024;

// Rounded-square macOS-style icon. Signal-colored orbs around a bright core.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#12151f"/>
      <stop offset="100%" stop-color="#05060a"/>
    </radialGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#9be7ff"/>
      <stop offset="100%" stop-color="#3a86ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#bg)"/>
  <g filter="url(#glow)">
    ${orbs()}
  </g>
  <circle cx="512" cy="512" r="120" fill="url(#core)"/>
  ${rings()}
</svg>`;

function orbs() {
  const palette = ['#ff5d73', '#5dd6ff', '#b5ff5d', '#ffd60a', '#8338ec', '#06ffa5', '#ff006e', '#ffea00'];
  const R = 300;
  let out = '';
  palette.forEach((c, i) => {
    const a = (i / palette.length) * Math.PI * 2 - Math.PI / 2;
    const x = 512 + Math.cos(a) * R;
    const y = 512 + Math.sin(a) * R;
    const r = 64 + (i % 3) * 18;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${c}" opacity="0.92"/>`;
  });
  return out;
}
function rings() {
  let out = '';
  [200, 300, 400].forEach((r, i) => {
    out += `<circle cx="512" cy="512" r="${r}" fill="none" stroke="#7088aa" stroke-opacity="${0.18 - i * 0.04}" stroke-width="3"/>`;
  });
  return out;
}

app.whenReady().then(async () => {
  const work = '/tmp/viz_icon';
  fs.mkdirSync(work, { recursive: true });
  const htmlPath = path.join(work, 'icon.html');
  fs.writeFileSync(htmlPath, `<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:#05060a">${SVG}</body></html>`);

  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, webPreferences: { offscreen: false } });
  await win.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const png = path.join(work, 'icon_1024.png');
  fs.writeFileSync(png, img.toPNG());

  // Build .iconset at all required sizes, then iconutil -> icns.
  const iconset = path.join(work, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  const specs = [
    [16, ''], [16, '@2x'], [32, ''], [32, '@2x'], [128, ''], [128, '@2x'],
    [256, ''], [256, '@2x'], [512, ''], [512, '@2x']
  ];
  for (const [sz, suf] of specs) {
    const px = suf === '@2x' ? sz * 2 : sz;
    const out = path.join(iconset, `icon_${sz}x${sz}${suf}.png`);
    execSync(`sips -z ${px} ${px} ${JSON.stringify(png)} --out ${JSON.stringify(out)}`, { stdio: 'ignore' });
  }
  const buildDir = path.join(ROOT, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const icns = path.join(buildDir, 'icon.icns');
  execSync(`iconutil -c icns ${JSON.stringify(iconset)} -o ${JSON.stringify(icns)}`);
  console.log('wrote', icns);
  app.quit();
});
