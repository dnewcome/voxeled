// dan-mx — a variable-frame IP LED protocol (github.com/dnewcome/dan-mx), byte-compatible with
// its Python/ESP32 receivers. voxeled treats it as a first-class custom protocol alongside
// Art-Net/DDP: proof that the scene owns mixed protocols and voxeled executes them.
//
// Wire: 14-byte big-endian header  "DMX2" | version=1 | flags=0 | encoding | color_space |
// transfer | seq | start_pixel(2) | pixel_count(2)  then body. We emit RAW / RGB888 / LINEAR
// (always valid; RLE/DELTA are optional sender optimizations the receiver also accepts as RAW).
import dgram from "node:dgram";

const MAGIC = Buffer.from("DMX2", "latin1");
export const ENC_RAW = 0;
export const CS_RGB888 = 0;
export const TF_LINEAR = 0;
const MAX_PIXELS_PER_FRAME = 486; // (1472 MTU − 14 header) / 3 bytes-per-pixel, no fragmenting

// Build one dan-mx RAW/RGB888 frame. `rgbBody` is 3·pixelCount bytes.
export function danmxFrame(seq, startPixel, pixelCount, rgbBody, { encoding = ENC_RAW, colorSpace = CS_RGB888, transfer = TF_LINEAR } = {}) {
  const h = Buffer.alloc(14);
  MAGIC.copy(h, 0);
  h[4] = 1; // version
  h[5] = 0; // flags
  h[6] = encoding;
  h[7] = colorSpace;
  h[8] = transfer;
  h[9] = seq & 0xff;
  h.writeUInt16BE(startPixel & 0xffff, 10);
  h.writeUInt16BE(pixelCount & 0xffff, 12);
  return Buffer.concat([h, rgbBody]);
}

// Send an RGB byte buffer as one-or-more dan-mx frames (chunked to stay under MTU).
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

export function createDanmxSender({ host, port = 6454, startPixel = 0 } = {}) {
  const sock = dgram.createSocket("udp4");
  let seq = 1;
  function send(rgb) {
    sendDanmx(sock, host, port, rgb, seq, startPixel);
    seq = (seq % 255) + 1;
  }
  return { send, close: () => sock.close(), kind: "danmx", target: `${host}:${port}` };
}
