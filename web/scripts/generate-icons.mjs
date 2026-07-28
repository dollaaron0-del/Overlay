// Generates placeholder PNG app icons (solid background + a simple "O" mark)
// so the PWA manifest has real files to point at. Replace these with a real
// logo whenever one exists — this script has no design ambition beyond
// "installable and non-broken".
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/icons");
mkdirSync(outDir, { recursive: true });

const BG = [11, 14, 20]; // #0b0e14
const FG = [86, 156, 214]; // accent blue

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Draws a simple ring ("O") mark on a solid background, no external deps. */
function renderPixels(size) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.34;
  const innerR = size * 0.2;
  for (let y = 0; y < size; y++) {
    let rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const onRing = dist <= outerR && dist >= innerR;
      const color = onRing ? FG : BG;
      const px = rowStart + 1 + x * 3;
      raw[px] = color[0];
      raw[px + 1] = color[1];
      raw[px + 2] = color[2];
    }
  }
  return raw;
}

function makePng(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = renderPixels(size);
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-512-maskable.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of targets) {
  writeFileSync(path.join(outDir, name), makePng(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
