/**
 * Generates PWA icons as PNG files without any native dependency.
 *
 * A minimal PNG encoder is implemented here (IHDR/IDAT/IEND + zlib + CRC32),
 * drawing a simple "expiry" glyph: a green rounded square with a white
 * barcode and a red exclamation badge.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "icons");

// ---------------------------------------------------------------- PNG encode

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode an RGBA pixel buffer (Uint8Array of length w*h*4) into a PNG. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- drawing logic

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

const GREEN = hexToRgb("#16a34a");
const GREEN_DARK = hexToRgb("#0b1220");
const WHITE = hexToRgb("#ffffff");
const RED = hexToRgb("#ef4444");

function roundedRectInside(x, y, size, margin, radius) {
  const x0 = margin;
  const y0 = margin;
  const x1 = size - margin;
  const y1 = size - margin;
  const cx = Math.max(x0 + radius, Math.min(x, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(y, y1 - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function circleInside(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Draw the icon. `safe` shrinks the content area (used for maskable icons so
 * content stays inside the safe zone).
 */
function drawIcon(size, safe = 0.12) {
  const rgba = new Uint8Array(size * size * 4);
  const contentMargin = Math.floor(size * safe);

  const barArea = {
    x0: Math.floor(size * 0.3),
    x1: Math.floor(size * 0.7),
    y0: Math.floor(size * 0.3),
    y1: Math.floor(size * 0.7),
  };
  const barWidths = [6, 3, 6, 3, 6, 3, 6].map((w) => Math.max(1, Math.round((w / 64) * size)));

  // badge (red circle with "!") top-right
  const badgeCx = Math.floor(size * 0.72);
  const badgeCy = Math.floor(size * 0.28);
  const badgeR = Math.floor(size * 0.14);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let px = GREEN;
      if (!roundedRectInside(x + 0.5, y + 0.5, size, Math.floor(size * 0.02), Math.floor(size * 0.16))) {
        px = GREEN_DARK; // page background outside the rounded card
      }

      // barcode bars
      let bx = barArea.x0;
      for (const w of barWidths) {
        if (x >= bx && x < bx + w && y >= barArea.y0 && y < barArea.y1) {
          px = WHITE;
          break;
        }
        bx += w + Math.max(1, Math.round((2 / 64) * size));
      }

      // exclamation badge
      if (circleInside(x + 0.5, y + 0.5, badgeCx, badgeCy, badgeR)) {
        // inside circle: red except the "!" glyph (rect bar + dot)
        const inBar = x >= badgeCx - size * 0.025 && x <= badgeCx + size * 0.025 && y >= badgeCy - badgeR * 0.55 && y <= badgeCy + badgeR * 0.15;
        const inDot = circleInside(x + 0.5, y + 0.5, badgeCx, badgeCy + badgeR * 0.5, Math.max(2, size * 0.022));
        px = inBar || inDot ? WHITE : RED;
      }

      rgba[idx] = px[0];
      rgba[idx + 1] = px[1];
      rgba[idx + 2] = px[2];
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

// --------------------------------------------------------------- output

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, safe: 0.04 },
  { name: "icon-512.png", size: 512, safe: 0.04 },
  { name: "icon-maskable-512.png", size: 512, safe: 0.12 },
  { name: "apple-touch-icon.png", size: 180, safe: 0.04 },
];

for (const t of targets) {
  const rgba = drawIcon(t.size, t.safe);
  const png = encodePng(t.size, t.size, rgba);
  const out = join(OUT_DIR, t.name);
  writeFileSync(out, png);
  console.log(`generated ${out} (${png.length} bytes)`);
}

// Simple SVG favicon (kept tiny, hand-written)
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#16a34a"/>
  <rect x="19" y="21" width="26" height="3" fill="#fff"/>
  <rect x="19" y="28" width="26" height="3" fill="#fff"/>
  <rect x="19" y="35" width="26" height="3" fill="#fff"/>
  <rect x="19" y="42" width="26" height="3" fill="#fff"/>
  <circle cx="47" cy="17" r="9" fill="#ef4444"/>
  <rect x="46" y="12" width="2" height="6" rx="1" fill="#fff"/>
  <circle cx="47" cy="21" r="1.5" fill="#fff"/>
</svg>`;
writeFileSync(join(OUT_DIR, "favicon.svg"), favicon);
console.log(`generated ${join(OUT_DIR, "favicon.svg")}`);