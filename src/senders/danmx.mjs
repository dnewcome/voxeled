// dan-mx — a variable-frame IP LED protocol (github.com/dnewcome/dan-mx), byte-compatible with
// its Python/ESP32 receivers. voxeled treats it as a first-class custom protocol alongside
// Art-Net/DDP: proof that the scene owns mixed protocols and voxeled executes them.
//
// Wire: 14-byte big-endian header  "DMX2" | version=1 | flags=0 | encoding | color_space |
// transfer | seq | start_pixel(2) | pixel_count(2)  then body.
//
// This mirrors dan-mx's own stream layer (danmx/stream.py, esp32/lib/danmx): each frame is emitted
// as the SMALLEST of RAW / RLE / DELTA. RLE runs are whole-pixel [count][pixel] (count 0 = 256);
// DELTA is the XOR against the previous frame, then RLE'd, so unchanged pixels collapse to zero
// runs. DELTA needs a reference, so a keyframe (RAW/RLE) is forced every `keyframeInterval` frames
// to recover from UDP loss — a delta received without a reference is dropped until the next keyframe.
import dgram from "node:dgram";

export const HEADER_LEN = 14;
const MAGIC = Buffer.from("DMX2", "latin1");

export const ENC_RAW = 0, ENC_RLE = 1, ENC_DELTA = 2;
export const CS_RGB888 = 0, CS_RGB565 = 1, CS_G6R5B5 = 2, CS_RGB888_LINEAR = 3;
export const TF_LINEAR = 0, TF_GAMMA_22 = 1, TF_SRGB = 2;

const MAX_PIXELS_PER_FRAME = 486; // (1472 MTU − 14 header) / 3 bpp, RAW/RGB888, no fragmenting

export function bytesPerPixel(cs) {
  if (cs === CS_RGB888 || cs === CS_RGB888_LINEAR) return 3;
  if (cs === CS_RGB565 || cs === CS_G6R5B5) return 2;
  throw new Error(`dan-mx: unknown color space ${cs}`);
}

// ── color-space packing (RGB888 triples in → packed bytes), mirrors danmx/color.py ──
export function packColor(rgb, cs) {
  if (cs === CS_RGB888 || cs === CS_RGB888_LINEAR) return Buffer.isBuffer(rgb) ? rgb : Buffer.from(rgb);
  const n = (rgb.length / 3) | 0;
  const out = Buffer.allocUnsafe(n * 2);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const v = cs === CS_RGB565
      ? ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
      : ((g & 0xfc) << 8) | ((r & 0xf8) << 2) | (b >> 3); // G6R5B5: green-weighted
    out.writeUInt16BE(v & 0xffff, i * 2);
  }
  return out;
}

export function unpackColor(data, count, cs) {
  if (cs === CS_RGB888 || cs === CS_RGB888_LINEAR) return Buffer.from(data.subarray(0, count * 3));
  const out = Buffer.allocUnsafe(count * 3);
  for (let i = 0; i < count; i++) {
    const v = data.readUInt16BE(i * 2);
    let r, g, b;
    if (cs === CS_RGB565) { r = (v >> 8) & 0xf8; g = (v >> 3) & 0xfc; b = (v << 3) & 0xf8; }
    else { g = (v >> 8) & 0xfc; r = (v >> 2) & 0xf8; b = (v << 3) & 0xf8; } // G6R5B5
    out[i * 3] = r | (r >> 5); out[i * 3 + 1] = g | (g >> 6); out[i * 3 + 2] = b | (b >> 5);
  }
  return out;
}

// ── pixel-level RLE, mirrors danmx/rle.py ──
const pixelEq = (buf, a, b, bpp) => { for (let k = 0; k < bpp; k++) if (buf[a * bpp + k] !== buf[b * bpp + k]) return false; return true; };

export function rleEncode(payload, bpp) {
  const out = [];
  const n = (payload.length / bpp) | 0;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (run < 256 && i + run < n && pixelEq(payload, i + run, i, bpp)) run++;
    out.push(run & 0xff);
    for (let k = 0; k < bpp; k++) out.push(payload[i * bpp + k]);
    i += run;
  }
  return Buffer.from(out);
}

export function rleDecode(data, bpp, pixelCount) {
  const out = Buffer.allocUnsafe(pixelCount * bpp);
  let i = 0, decoded = 0;
  while (decoded < pixelCount) {
    const run = data[i++] || 256;
    const px = data.subarray(i, i + bpp); i += bpp;
    for (let r = 0; r < run && decoded < pixelCount; r++, decoded++) px.copy(out, decoded * bpp); // clamp: last run may overshoot
  }
  return out;
}

const xorBytes = (a, b) => { const out = Buffer.allocUnsafe(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]; return out; };

// Build one dan-mx frame: header + a body that is ALREADY in wire form for `encoding`.
export function danmxFrame(seq, startPixel, pixelCount, body, { encoding = ENC_RAW, colorSpace = CS_RGB888, transfer = TF_LINEAR } = {}) {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h[4] = 1; // version
  h[5] = 0; // flags
  h[6] = encoding;
  h[7] = colorSpace;
  h[8] = transfer;
  h[9] = seq & 0xff;
  h.writeUInt16BE(startPixel & 0xffff, 10);
  h.writeUInt16BE(pixelCount & 0xffff, 12);
  return Buffer.concat([h, body]);
}

// Normalize a patch's dan-mx options (strings) → the numeric enums DanmxStream expects.
export function danmxOpts(o = {}) {
  // Default RAW: compression is opt-in per patch, so existing scenes are byte-for-byte unchanged.
  const enc = String(o.encoding ?? "raw").toLowerCase();
  const cs = { rgb888: 0, rgb565: 1, g6r5b5: 2, rgb888_linear: 3 }[String(o.colorSpace ?? "rgb888").toLowerCase()] ?? CS_RGB888;
  const tf = { linear: 0, gamma22: 1, "gamma2.2": 1, srgb: 2 }[String(o.transfer ?? "linear").toLowerCase()] ?? TF_LINEAR;
  return {
    encoding: ["raw", "rle", "delta", "auto"].includes(enc) ? enc : "auto",
    colorSpace: cs, transfer: tf, keyframeInterval: o.keyframeInterval || 30,
  };
}

// Stateful encoder: turns one logical RGB888 frame into one-or-more wire datagrams, choosing the
// smallest encoding per chunk and MTU-chunking wide strips into separate start_pixel ranges.
export class DanmxStream {
  constructor({ encoding = "auto", colorSpace = CS_RGB888, transfer = TF_LINEAR, keyframeInterval = 30, maxWireBytes = 1472, startPixel = 0 } = {}) {
    this.mode = encoding; this.cs = colorSpace; this.tf = transfer;
    this.keyframeInterval = keyframeInterval; this.startPixel = startPixel;
    this.bpp = bytesPerPixel(colorSpace);
    this.maxPx = Math.max(1, Math.floor((maxWireBytes - HEADER_LEN) / this.bpp));
    this._chunks = []; // per fixed pixel-range: { ref, since } — DELTA state per chunk
  }

  frames(rgb888, seq = 0) {
    const packed = packColor(rgb888, this.cs);
    const total = (packed.length / this.bpp) | 0;
    const nChunks = Math.ceil(total / this.maxPx) || 0;
    if (this._chunks.length !== nChunks) this._chunks = Array.from({ length: nChunks }, () => ({ ref: null, since: Infinity }));
    const out = [];
    let px = 0, ci = 0;
    while (px < total) {
      const n = Math.min(this.maxPx, total - px);
      const raw = packed.subarray(px * this.bpp, (px + n) * this.bpp);
      out.push(this._encodeChunk(raw, this._chunks[ci++], this.startPixel + px, n, seq));
      px += n;
    }
    return out;
  }

  _encodeChunk(raw, st, startPixel, pixelCount, seq) {
    let best = { mode: ENC_RAW, body: raw, size: raw.length };
    if (this.mode !== "raw") {
      const rleBody = rleEncode(raw, this.bpp);
      if (rleBody.length < best.size) best = { mode: ENC_RLE, body: rleBody, size: rleBody.length };
      const keyframeDue = st.since >= this.keyframeInterval;
      if ((this.mode === "delta" || this.mode === "auto") && st.ref && !keyframeDue && st.ref.length === raw.length) {
        const deltaBody = rleEncode(xorBytes(st.ref, raw), this.bpp);
        if (deltaBody.length < best.size) best = { mode: ENC_DELTA, body: deltaBody, size: deltaBody.length };
      }
    }
    const wire = danmxFrame(seq, startPixel, pixelCount, best.body, { encoding: best.mode, colorSpace: this.cs, transfer: this.tf });
    st.ref = Buffer.from(raw); // copy: raw is a view into `packed`
    st.since = best.mode === ENC_DELTA ? st.since + 1 : 0;
    return wire;
  }
}

// Decode one wire frame → header + payload (for DELTA, payload is the XOR-delta stream).
export function decodeDanmxFrame(buf) {
  if (buf.length < HEADER_LEN) throw new Error("dan-mx: short frame");
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("dan-mx: bad magic");
  if (buf[4] !== 1) throw new Error(`dan-mx: unsupported version ${buf[4]}`);
  const encoding = buf[6], colorSpace = buf[7], transfer = buf[8], seq = buf[9];
  const startPixel = buf.readUInt16BE(10), pixelCount = buf.readUInt16BE(12);
  const body = buf.subarray(HEADER_LEN), bpp = bytesPerPixel(colorSpace);
  let payload;
  if (encoding === ENC_RAW) payload = body;
  else if (encoding === ENC_RLE || encoding === ENC_DELTA) payload = rleDecode(body, bpp, pixelCount);
  else throw new Error(`dan-mx: bad encoding ${encoding}`);
  return { seq, startPixel, pixelCount, encoding, colorSpace, transfer, payload };
}

// Stateful decoder: reconstructs full payloads, applying DELTA against the last reference.
// Returns null for a DELTA with no usable reference (wait for a keyframe) — mirrors stream.py.
export class DanmxStreamDecoder {
  constructor() { this._ref = null; }
  decode(buf) {
    const f = decodeDanmxFrame(buf);
    if (f.encoding === ENC_DELTA) {
      if (!this._ref || this._ref.length !== f.payload.length) return null;
      f.payload = xorBytes(this._ref, f.payload);
    }
    this._ref = f.payload;
    return f;
  }
}

// Stateless RAW sender (kept for simple callers; the dispatcher uses DanmxStream for compression).
export function sendDanmx(sock, host, port, rgb, seq, startPixel = 0) {
  const total = (rgb.length / 3) | 0;
  let px = 0;
  while (px < total) {
    const n = Math.min(MAX_PIXELS_PER_FRAME, total - px);
    const body = rgb.subarray(px * 3, (px + n) * 3);
    sock.send(danmxFrame(seq, startPixel + px, n, body), port, host);
    px += n;
  }
}

// Standalone sender with compression (RLE/DELTA) and color-space/transfer options.
export function createDanmxSender({ host, port = 6454, startPixel = 0, encoding = "auto", colorSpace = CS_RGB888, transfer = TF_LINEAR, keyframeInterval = 30 } = {}) {
  const sock = dgram.createSocket("udp4");
  const stream = new DanmxStream({ encoding, colorSpace, transfer, keyframeInterval, startPixel });
  let seq = 1;
  function send(rgb) {
    for (const wire of stream.frames(rgb, seq)) sock.send(wire, port, host);
    seq = (seq % 255) + 1;
  }
  return { send, close: () => sock.close(), kind: "danmx", target: `${host}:${port}` };
}
