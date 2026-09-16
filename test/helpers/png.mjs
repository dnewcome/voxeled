// Minimal PNG encode/decode (8-bit RGB/RGBA, non-interlaced) — enough to write test panoramas and
// read Chrome's screenshots back. Dependency-free like the rest of the repo.
import zlib from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };

// rgb: Uint8Array of width*height*3
export function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.subarray(y * width * 3, (y + 1) * width * 3).forEach((v, i) => (raw[y * (width * 3 + 1) + 1 + i] = v)); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function decodePNG(buf) {
  let off = 8, width = 0, height = 0, bpp = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); const ct = data[9]; bpp = { 2: 3, 6: 4, 0: 1, 4: 2 }[ct]; if (data[8] !== 8 || data[12]) throw new Error("png: only 8-bit non-interlaced"); }
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * bpp, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[prev + i] : 0, c = y && i >= bpp ? out[prev + i - bpp] : 0, x = raw[src + i];
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[dst + i] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out, at: (x, y) => { const i = (y * width + x) * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

// A compass test panorama (equirectangular): the horizon band is a pure colour per quadrant —
// north red, east green, south blue, west yellow — centre column at `headingDeg`; sky/ground darker.
export const COMPASS = { n: [255, 0, 0], e: [0, 255, 0], s: [0, 0, 255], w: [255, 255, 0] };
export function compassPanorama(width = 1024, height = 512, headingDeg = 0) {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bearing = (((x + 0.5) / width - 0.5) * 360 + headingDeg + 360 * 4) % 360;
    const q = bearing < 45 || bearing >= 315 ? "n" : bearing < 135 ? "e" : bearing < 225 ? "s" : "w";
    const elev = 0.5 - (y + 0.5) / height; // +0.5 zenith … −0.5 nadir
    const k = Math.abs(elev) < 0.08 ? 1 : elev > 0 ? 0.35 : 0.2;
    const i = (y * width + x) * 3, c = COMPASS[q];
    rgb[i] = c[0] * k; rgb[i + 1] = c[1] * k; rgb[i + 2] = c[2] * k;
  }
  return encodePNG(width, height, rgb);
}
// A solid-colour face with strips along its TOP / LEFT edges (to check the up/down face orientation + handedness).
export function faceImage(size, color, topStrip = null, leftStrip = null) {
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 3, c = topStrip && y < size * 0.15 ? topStrip : leftStrip && x < size * 0.15 ? leftStrip : color; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; }
  return encodePNG(size, size, rgb);
}
