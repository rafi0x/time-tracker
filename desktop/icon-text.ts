// Renders timer text ("1:23:45") to a PNG for use as a tray icon.
// Pure TypeScript: 5x7 bitmap font + minimal PNG encoder (zlib via node:zlib),
// no native dependencies so it survives deno compile for every target.

import { deflateSync } from "node:zlib";

// 5x7 glyphs, rows top->bottom, 5 bits each (MSB = left column).
const GLYPHS: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ":": [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  "-": [0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000],
};

const CHAR_W = 5;
const CHAR_H = 7;
const GAP = 1;

// --- PNG encoding ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode RGBA pixels as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter type 0 prepended to each scanline
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

export interface TextIconOptions {
  height?: number; // icon height in px
  scale?: number; // glyph pixel size
  color?: [number, number, number]; // text RGB
}

/** Render text (digits, ":", "-") into a PNG suitable for a tray icon. */
export function renderTextIcon(text: string, opts: TextIconOptions = {}): Uint8Array {
  const { height = 22, scale = 2, color = [255, 255, 255] } = opts;
  const textW = text.length * (CHAR_W + GAP) * scale - GAP * scale;
  const width = textW + 2; // 1px side padding
  const rgba = new Uint8Array(width * height * 4);
  const top = Math.floor((height - CHAR_H * scale) / 2);
  const [r, g, b] = color;

  for (let ci = 0; ci < text.length; ci++) {
    const glyph = GLYPHS[text[ci]];
    if (!glyph) continue;
    const x0 = 1 + ci * (CHAR_W + GAP) * scale;
    for (let gy = 0; gy < CHAR_H; gy++) {
      const rowBits = glyph[gy];
      for (let gx = 0; gx < CHAR_W; gx++) {
        if (!(rowBits & (1 << (CHAR_W - 1 - gx)))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x0 + gx * scale + sx;
            const py = top + gy * scale + sy;
            const i = (py * width + px) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
          }
        }
      }
    }
  }
  return encodePng(width, height, rgba);
}

/** Simple clock glyph used when no timer is running. */
export function renderIdleIcon(opts: TextIconOptions = {}): Uint8Array {
  const { height = 22, color = [255, 255, 255] } = opts;
  const size = height;
  const rgba = new Uint8Array(size * size * 4);
  const [r, g, b] = color;
  const c = (size - 1) / 2;
  const radius = size / 2 - 2;

  const set = (x: number, y: number, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (Math.round(y) * size + Math.round(x)) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = Math.max(rgba[i + 3], a);
  };

  // circle outline
  for (let deg = 0; deg < 360; deg += 2) {
    const rad = (deg * Math.PI) / 180;
    set(c + radius * Math.cos(rad), c + radius * Math.sin(rad));
  }
  // hands: minute up, hour right
  for (let t = 0; t <= radius - 3; t += 0.5) set(c, c - t);
  for (let t = 0; t <= radius - 5; t += 0.5) set(c + t, c);

  return encodePng(size, size, rgba);
}

/** Compact tray text: H:MM:SS once over an hour, else MM:SS. */
export function trayTimeText(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
