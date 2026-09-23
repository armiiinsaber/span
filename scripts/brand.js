// Draws every icon and iOS splash screen into public/brand/ with no dependencies.
// The mark is a placeholder: ten day dots, four done. To swap in the real logo,
// replace the files in public/brand/ keeping the same names (see README), then
// bump CACHE in public/sw.js. Run with: node scripts/brand.js
// It also rewrites the brand block in public/index.html.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAPER = [0xF5, 0xF3, 0xEC], INK = [0x14, 0x13, 0x10], GREEN = [0xB8, 0xF0, 0x6E];
const OUT = path.join(__dirname, '..', 'public', 'brand');

// iOS splash sizes in device pixels, with the CSS size and pixel ratio for the media query.
const SPLASH = [
  [375, 667, 2], [375, 812, 3], [390, 844, 3], [393, 852, 3], [402, 874, 3],
  [414, 896, 2], [414, 896, 3], [428, 926, 3], [430, 932, 3], [440, 956, 3],
];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Paints the mark with its row of five dots `markWidth` pixels wide, centred at (cx, cy).
function draw(w, h, markWidth, cx = w / 2, cy = h / 2) {
  const SS = 4;
  const pitch = markWidth / 4.6;
  const r = pitch * 0.34, stroke = Math.max(1.5, pitch * 0.075);
  const ox = cx - pitch * 2, oy = cy - pitch / 2;
  const dots = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) dots.push({ x: ox + i * pitch, y: oy + j * pitch, done: j * 5 + i < 4 });
  const reach = r + stroke;
  const colorAt = (px, py) => {
    for (const d of dots) {
      const dist = Math.hypot(px - d.x, py - d.y);
      if (dist <= r + stroke / 2) return dist >= r - stroke / 2 ? INK : d.done ? GREEN : PAPER;
    }
    return PAPER;
  };
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    const nearRow = y + 1 >= oy - reach && y <= oy + pitch + reach;
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 3;
      if (!nearRow || x + 1 < ox - reach || x > ox + pitch * 4 + reach) { raw[o] = PAPER[0]; raw[o + 1] = PAPER[1]; raw[o + 2] = PAPER[2]; continue; }
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(x + (sx + .5) / SS, y + (sy + .5) / SS);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
const icon = (name, size, pad) => fs.writeFileSync(path.join(OUT, name), draw(size, size, size * (1 - pad * 2) * 0.82));
icon('icon-180.png', 180, .08);
icon('icon-192.png', 192, .08);
icon('icon-512.png', 512, .08);
icon('icon-maskable-512.png', 512, .2);
fs.writeFileSync(path.join(OUT, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F5F3EC"/><g stroke="#141310" stroke-width="2"><circle cx="12" cy="26" r="4.5" fill="#B8F06E"/><circle cx="22" cy="26" r="4.5" fill="#B8F06E"/><circle cx="32" cy="26" r="4.5" fill="#B8F06E"/><circle cx="42" cy="26" r="4.5" fill="#B8F06E"/><circle cx="52" cy="26" r="4.5" fill="none"/><circle cx="12" cy="38" r="4.5" fill="none"/><circle cx="22" cy="38" r="4.5" fill="none"/><circle cx="32" cy="38" r="4.5" fill="none"/><circle cx="42" cy="38" r="4.5" fill="none"/><circle cx="52" cy="38" r="4.5" fill="none"/></g></svg>\n');

const links = [];
for (const [cw, ch, dpr] of SPLASH) {
  const w = cw * dpr, h = ch * dpr, name = `splash-${w}x${h}.png`;
  fs.writeFileSync(path.join(OUT, name), draw(w, h, 120 * dpr));
  links.push(`<link rel="apple-touch-startup-image" href="/brand/${name}" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`);
}
// Rewrite the brand block in index.html so every reference stays in one place.
const page = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(page, 'utf8');
const block = [
  '<!-- Brand: every icon and splash screen lives in /brand/. Swap the files there to change the logo. -->',
  '<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/brand/icon-180.png">',
  ...links,
  '<!-- End brand -->',
].join('\n');
const next = html.replace(/<!-- Brand:[\s\S]*?<!-- End brand -->/, block);
if (next === html && !html.includes(block)) throw new Error('Brand block not found in index.html');
fs.writeFileSync(page, next);
console.log(`brand written to ${OUT} and index.html`);
