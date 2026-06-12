/**
 * Generate deterministic PNG fixtures for the Playwright screenshot tests.
 *
 * The screenshot suite needs real raster images (so the viewer/filmstrip render
 * accurately) that are byte-stable across machines. Rather than commit opaque
 * binaries with no provenance, we synthesize them here from a tiny dependency-
 * free PNG encoder: a fixed set of two-tone vertical gradients, one per folder
 * entry. Re-run with `node scripts/gen-e2e-fixtures.mjs` if the set changes.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../e2e/screenshots/_fixtures",
);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGB pixel buffer (width*height*3) as a PNG. */
function encodePng(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend a per-row filter byte (0 = none).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function gradient(width, height, top, bottom) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const t = height === 1 ? 0 : y / (height - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    for (let x = 0; x < width; x++) {
      // A faint vertical seam every 80px gives the filmstrip thumbnails some
      // structure so cropping/scaling regressions are visible, not just a wash.
      const seam = x % 80 === 0 ? 0.82 : 1;
      const i = (y * width + x) * 3;
      rgb[i] = Math.round(r * seam);
      rgb[i + 1] = Math.round(g * seam);
      rgb[i + 2] = Math.round(b * seam);
    }
  }
  return rgb;
}

const W = 600;
const H = 400;

const FIXTURES = {
  "a.png": [[220, 60, 60], [120, 20, 20]],
  "b.png": [[60, 160, 90], [20, 80, 40]],
  "c.png": [[70, 110, 210], [20, 40, 110]],
  "d.png": [[210, 170, 60], [120, 90, 20]],
  "e.png": [[150, 80, 200], [70, 30, 110]],
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, [top, bottom]] of Object.entries(FIXTURES)) {
  const png = encodePng(W, H, gradient(W, H, top, bottom));
  writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
