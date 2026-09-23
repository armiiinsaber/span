// Draws the app icons as PNG with no dependencies: ivory ground, ten day dots, four done.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAPER = [0xF5, 0xF3, 0xEC], INK = [0x14, 0x13, 0x10], GREEN = [0xB8, 0xF0, 0x6E];

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

function draw(size, pad = 0) {
  const SS = 4; // supersampling
  const inner = size * (1 - pad * 2);
  const cols = 5, rows = 2;
  const pitch = inner / 5.6;
  const r = pitch * 0.34, stroke = pitch * 0.075;
  const ox = (size - pitch * (cols - 1)) / 2, oy = (size - pitch * (rows - 1)) / 2;
  const dots = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) dots.push({ x: ox + i * pitch, y: oy + j * pitch, done: j * cols + i < 4 });
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + .5) / SS, py = y + (sy + .5) / SS;
        let col = PAPER;
        for (const d of dots) {
          const dist = Math.hypot(px - d.x, py - d.y);
          if (dist <= r + stroke / 2) { col = dist >= r - stroke / 2 ? INK : d.done ? GREEN : PAPER; break; }
        }
        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(out, 'icon-180.png'), draw(180, .08));
fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, .08));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, .08));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, .2));
console.log('icons written');
