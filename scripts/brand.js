// Builds every icon and iOS splash screen in public/brand/ from the SVG marks in brand/.
// The marks are only circles (plus a background rect on the app icon), so this file
// reads them and paints them itself, with no image libraries.
//
//   brand/deka-mark-small.svg  ->  public/brand/icon.svg (favicon, ink on transparent)
//   brand/deka-icon.svg        ->  public/brand/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png
//   brand/deka-mark-ink.svg    ->  public/brand/splash-<w>x<h>.png (ivory ground, small ink mark)
//                                  public/brand/splash-dark-<w>x<h>.png (warm near black, ivory mark)
//
// It also rewrites the brand block in public/index.html. After changing a mark, run
// `node scripts/brand.js`, then bump CACHE in public/sw.js. The marks themselves come
// from scripts/trace_mark.py.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'brand');
const OUT = path.join(ROOT, 'public', 'brand');
const PAPER = '#F5F3EC';
const NIGHT = '#14130F';

// iOS splash sizes in CSS pixels with the pixel ratio, for the media queries.
const SPLASH = [
  [375, 667, 2], [375, 812, 3], [390, 844, 3], [393, 852, 3], [402, 874, 3],
  [414, 896, 2], [414, 896, 3], [428, 926, 3], [430, 932, 3], [440, 956, 3],
];

/* Reading the marks */

function readSvg(file) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8');
  const num = (tag, name) => Number((tag.match(new RegExp(`\\s${name}="([^"]+)"`)) || [])[1]);
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]+)"`)) || [])[1];
  const root = text.match(/<svg[^>]*>/)[0];
  const side = Number(attr(root, 'viewBox').split(/\s+/)[2]);
  const rootFill = attr(root, 'fill') || '#000000';
  const rect = (text.match(/<rect[^>]*>/) || [])[0];
  const dots = [...text.matchAll(/<circle[^>]*>/g)].map(([tag]) => ({
    id: attr(tag, 'id'), cx: num(tag, 'cx'), cy: num(tag, 'cy'), r: num(tag, 'r'), fill: attr(tag, 'fill') || rootFill,
  }));
  return { text, side, background: rect ? attr(rect, 'fill') : null, dots };
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/* Painting */

// Paints dots onto a w by h canvas. `place` maps the mark's viewBox onto the canvas:
// the mark's centre lands at (x, y) and one viewBox unit becomes `scale` pixels.
function paint(w, h, background, dots, { x, y, scale, side }) {
  const px = new Float32Array(w * h * 3);
  const bg = rgb(background);
  for (let i = 0; i < w * h; i++) px.set(bg, i * 3);
  for (const d of dots) {
    const cx = x + (d.cx - side / 2) * scale, cy = y + (d.cy - side / 2) * scale, r = d.r * scale;
    const col = rgb(d.fill);
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let py = y0; py <= y1; py++) {
      for (let pxx = x0; pxx <= x1; pxx++) {
        let cover;
        const dist = Math.hypot(pxx + .5 - cx, py + .5 - cy);
        if (dist <= r - .75) cover = 1;
        else if (dist >= r + .75) cover = 0;
        else {
          // Near the edge: supersample 6 by 6 for a clean anti aliased rim.
          let hit = 0;
          for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
            if (Math.hypot(pxx + (sx + .5) / 6 - cx, py + (sy + .5) / 6 - cy) <= r) hit++;
          }
          cover = hit / 36;
        }
        if (!cover) continue;
        const o = (py * w + pxx) * 3;
        for (let k = 0; k < 3; k++) px[o + k] = px[o + k] * (1 - cover) + col[k] * cover;
      }
    }
  }
  return png(w, h, px);
}

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
// Opaque RGB PNG: iOS draws transparent icon pixels black.
function png(w, h, px) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * row + 1 + x] = Math.round(px[y * w * 3 + x]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* Build */

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const icon = readSvg('deka-icon.svg');
  const ink = readSvg('deka-mark-ink.svg');
  const small = readSvg('deka-mark-small.svg');

  // Favicon: the small variant, ink on transparent, as is.
  fs.writeFileSync(path.join(OUT, 'icon.svg'), small.text);

  // App icons: the icon SVG already leaves room inside the iOS corner radius.
  for (const size of [180, 192, 512]) {
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), paint(size, size, icon.background, icon.dots, { x: size / 2, y: size / 2, scale: size / icon.side, side: icon.side }));
  }
  // Maskable: shrink the mark so its farthest edge sits inside the 40 percent safe circle.
  const reach = Math.max(...icon.dots.map(d => Math.hypot(d.cx - icon.side / 2, d.cy - icon.side / 2) + d.r)) / icon.side;
  const fit = (0.40 * 0.94) / reach;
  fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), paint(512, 512, icon.background, icon.dots, { x: 256, y: 256, scale: (512 / icon.side) * Math.min(1, fit), side: icon.side }));

  // Splash screens: the app's own ground with the mark centred, 96 CSS pixels tall. The dark ones
  // come first; where the color scheme query is not understood they are skipped and ivory is used.
  const dark = [], links = [];
  const ivoryDots = ink.dots.map(d => ({ ...d, fill: PAPER }));
  for (const [cw, ch, dpr] of SPLASH) {
    const w = cw * dpr, h = ch * dpr, name = `splash-${w}x${h}.png`, night = `splash-dark-${w}x${h}.png`;
    const at = { x: w / 2, y: h / 2, scale: (96 * dpr) / ink.side, side: ink.side };
    const media = `(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`;
    fs.writeFileSync(path.join(OUT, name), paint(w, h, PAPER, ink.dots, at));
    fs.writeFileSync(path.join(OUT, night), paint(w, h, NIGHT, ivoryDots, at));
    dark.push(`<link rel="apple-touch-startup-image" href="/brand/${night}" media="${media} and (prefers-color-scheme: dark)">`);
    links.push(`<link rel="apple-touch-startup-image" href="/brand/${name}" media="${media}">`);
  }
  links.unshift(...dark);

  // Keep every icon and splash reference in one block in index.html.
  const page = path.join(ROOT, 'public', 'index.html');
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
  return { paint, readSvg };
}

if (require.main === module) build();
module.exports = { paint, readSvg };
