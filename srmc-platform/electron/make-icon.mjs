/**
 * make-icon.mjs — Generates electron/icon.png (512x512), the app icon.
 *
 * Dependency-free PNG encoder. Draws a rounded blue tile with a lighter
 * inner ring — a simple, intentional brand mark. electron-builder converts
 * this PNG to platform formats (.ico / .icns) at build time.
 *
 * Run: node electron/make-icon.mjs
 */

import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 512;

// ── Palette ────────────────────────────────────────────────────────────────
const BG_TOP    = [0x0E, 0x4F, 0x8E]; // deep blue
const BG_BOT    = [0x1A, 0x73, 0xC8]; // brand blue
const RING      = [0xFF, 0xFF, 0xFF];
const TRANSPARENT = [0, 0, 0, 0];

const px = Buffer.alloc(SIZE * SIZE * 4);

function set(x, y, [r, g, b, a = 255]) {
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

const radius = 96;           // corner radius of the tile
const cx = SIZE / 2, cy = SIZE / 2;

function insideRoundedRect(x, y) {
  const inset = 24;
  const minX = inset, minY = inset, maxX = SIZE - inset, maxY = SIZE - inset;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  const rx = Math.min(Math.max(x, minX + radius), maxX - radius);
  const ry = Math.min(Math.max(y, minY + radius), maxY - radius);
  const dx = x - rx, dy = y - ry;
  return dx * dx + dy * dy <= radius * radius;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!insideRoundedRect(x, y)) { set(x, y, TRANSPARENT); continue; }

    // Vertical gradient background.
    const t = y / SIZE;
    const r = Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t);
    const g = Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t);
    const b = Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t);
    set(x, y, [r, g, b, 255]);

    // White ring (the "broadcast" mark).
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist > 120 && dist < 138) set(x, y, [...RING, 255]);
    if (dist > 158 && dist < 168) set(x, y, [...RING, 160]);
    if (dist < 40) set(x, y, [...RING, 255]); // center dot
  }
}

// ── Minimal PNG encoder ──────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// Add a filter byte (0) at the start of each scanline.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(__dirname, 'icon.png');
writeFileSync(out, png);
console.log('Wrote', out, `(${png.length} bytes)`);
