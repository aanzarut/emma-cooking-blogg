/* Renders assets/icon.svg into a multi-size Windows .ico.
   Run with:  npm run icon */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../studio/lib/paths.js';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const source = path.join(ROOT, 'assets', 'icon.svg');
const target = path.join(ROOT, 'assets', 'recipe-studio.ico');

const svg = fs.readFileSync(source);
const pngs = [];
for (const size of SIZES) {
  pngs.push({ size, data: await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer() });
}

/* A .ico is a small header, one 16-byte directory entry per image, then the
   image payloads. Windows Vista and later accept PNG payloads directly. */
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const entries = [];
for (const { size, data } of pngs) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);  // 0 means 256
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);              // palette colours
  entry.writeUInt8(0, 3);              // reserved
  entry.writeUInt16LE(1, 4);           // colour planes
  entry.writeUInt16LE(32, 6);          // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += data.length;
}

fs.writeFileSync(target, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));

// A PNG copy too, for the About page or a favicon later.
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(ROOT, 'assets', 'recipe-studio.png'));

console.log(`Wrote ${path.relative(ROOT, target)} (${SIZES.join(', ')} px) and recipe-studio.png`);
