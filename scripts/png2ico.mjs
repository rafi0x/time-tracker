// Generate icons/app.ico from icons/repeat.png.
// ICO container with PNG-compressed entries (valid on Windows Vista+).
// Usage: node scripts/png2ico.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = new URL("../icons/repeat.png", import.meta.url).pathname;
const OUT = new URL("../icons/app.ico", import.meta.url).pathname;
const SIZES = [256, 48, 32, 16];

const pngs = await Promise.all(
  SIZES.map((size) => sharp(SRC).resize(size, size).png().toBuffer()),
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

const entries = [];
let offset = 6 + 16 * SIZES.length;
for (let i = 0; i < SIZES.length; i++) {
  const e = Buffer.alloc(16);
  e.writeUInt8(SIZES[i] === 256 ? 0 : SIZES[i], 0); // width (0 = 256)
  e.writeUInt8(SIZES[i] === 256 ? 0 : SIZES[i], 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bit depth
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(e);
}

writeFileSync(OUT, Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote ${OUT} (${offset} bytes)`);
