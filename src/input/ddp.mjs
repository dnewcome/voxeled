// DDP receiver — voxeled as a native DDP *Display* (3waylabs.com/ddp, protocol v1, UDP 4048).
//
// DDP is the pixel-streaming lingua franca (WLED, FPP/Falcon, xLights, LedFx, Chromatik…). With
// this input any of them can drive a voxeled piece: frames land on the bus (preview + simulator)
// and on the patch dispatcher — so DDP in becomes Art-Net / dan-mx / DDP out, per fixture. The
// hub also answers DDP's JSON status/config queries, so senders can *discover* it as a device.
//
// Implemented: write to ID 1 / 255 with data offset + length into a framebuffer; PUSH displays
// (also a bare broadcast PUSH); non-PUSH senders are displayed when the next frame starts at
// offset 0; data types RGB / RGBW (white folded in) / grayscale / "as configured"; Query on
// status (251), config (250), the framebuffer (1), and a proper empty Reply for anything else;
// back-to-back duplicate suppression by sequence number. Timecode is parsed and ignored (display
// immediately); Storage-sourced data and DMX transit (254) are accepted but not mapped.
import dgram from "node:dgram";
import os from "node:os";

const F_TIME = 0x10, F_STORAGE = 0x08, F_REPLY = 0x04, F_QUERY = 0x02, F_PUSH = 0x01;
export const ID_DISPLAY = 1, ID_CONTROL = 246, ID_CONFIG = 250, ID_STATUS = 251, ID_DMX = 254, ID_ALL = 255;
const MAX_FB = 16 * 1024 * 1024;

export function ddpHeader({ flags = 0, seq = 0, type = 0, id = ID_DISPLAY, offset = 0, len = 0 }) {
  const b = Buffer.alloc(10);
  b[0] = 0x40 | flags; b[1] = seq & 0x0f; b[2] = type; b[3] = id;
  b.writeUInt32BE(offset >>> 0, 4); b.writeUInt16BE(len & 0xffff, 8);
  return b;
}

// data type byte: C R TTT SSS — convert what we receive into packed RGB888
function toRGB(data, type) {
  const T = (type >> 3) & 7, S = type & 7;
  if (type === 0 || (T === 1 && (S === 3 || S === 0))) return Buffer.from(data); // as-configured / RGB 8-bit
  if (T === 3 && (S === 3 || S === 0)) { // RGBW → fold white into the channels
    const n = (data.length / 4) | 0, out = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) { const w = data[i * 4 + 3]; for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, data[i * 4 + c] + w); }
    return out;
  }
  if (T === 4 && (S === 3 || S === 0)) { // grayscale → replicate
    const out = Buffer.alloc(data.length * 3);
    for (let i = 0; i < data.length; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[i];
    return out;
  }
  return Buffer.from(data); // other widths: pass through as bytes
}

export function createDDPInput({ port = 4048, host = "0.0.0.0", pixelCount = 0, onFrame, name = "voxeled", version = "0.0.1" } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const expected = pixelCount * 3;
  let fb = Buffer.alloc(Math.max(3, expected));
  let dirty = false, highWater = 0, last = null;
  const stats = { packets: 0, frames: 0, queries: 0, duplicates: 0, senders: new Set(), lastType: 0, lastFrom: null };
  const nic = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  const mac = nic?.mac || "00:00:00:00:00:00", ip = nic?.address || "0.0.0.0";

  const deliver = () => {
    if (!dirty) return;
    const n = expected || highWater;
    dirty = false; stats.frames++;
    try { onFrame?.(new Uint8Array(fb.subarray(0, n))); } catch { /* keep receiving */ }
  };
  const reply = (rinfo, id, offset, data, seq) => {
    const d = data ? Buffer.from(data) : Buffer.alloc(0);
    sock.send(Buffer.concat([ddpHeader({ flags: F_REPLY | F_PUSH, seq, id, offset, len: d.length }), d]), rinfo.port, rinfo.address);
  };
  const handleQuery = (rinfo, id, offset, len, seq) => {
    stats.queries++;
    if (id === ID_STATUS) reply(rinfo, id, 0, JSON.stringify({ status: { man: "voxeled", mod: "hub", ver: version, mac, push: true, ntp: false, name, pixels: pixelCount } }), seq);
    else if (id === ID_CONFIG) reply(rinfo, id, 0, JSON.stringify({ config: { ip, ports: [{ port: 1, l: pixelCount, ss: 0 }] } }), seq);
    else if (id === ID_DISPLAY || id === ID_ALL) { const n = expected || highWater; reply(rinfo, ID_DISPLAY, offset, fb.subarray(Math.min(offset, n), Math.min(n, offset + len)), seq); }
    else reply(rinfo, id, 0, null, seq); // "reading not supported": offset 0, length 0, Push
  };

  sock.on("message", (msg, rinfo) => {
    if (msg.length < 10 || ((msg[0] >> 6) & 3) !== 1) return; // DDP v1 only
    const flags = msg[0];
    if (flags & F_REPLY) return; // we are a Display; replies aren't for us
    const seq = msg[1] & 0x0f, type = msg[2], id = msg[3], offset = msg.readUInt32BE(4), len = msg.readUInt16BE(8);
    const hdr = flags & F_TIME ? 14 : 10;
    const data = msg.subarray(hdr, hdr + len);
    stats.packets++; stats.senders.add(rinfo.address); stats.lastFrom = rinfo.address;
    if (seq && last && last.seq === seq && last.offset === offset && last.len === len && last.id === id && last.flags === flags) { stats.duplicates++; return; }
    last = { seq, offset, len, id, flags };
    if (flags & F_QUERY) return handleQuery(rinfo, id, offset, len, seq);
    if (flags & F_STORAGE) return;
    if (id === ID_DISPLAY || id === ID_ALL) {
      if (len > 0) {
        if (offset === 0 && dirty && highWater > 0) deliver(); // a non-PUSH sender started a new frame
        const rgb = toRGB(data, type);
        stats.lastType = type;
        const end = offset + rgb.length;
        if (end > MAX_FB) return;
        if (end > fb.length) { const nb = Buffer.alloc(Math.min(MAX_FB, Math.max(end, fb.length * 2))); fb.copy(nb); fb = nb; }
        rgb.copy(fb, offset);
        highWater = Math.max(highWater, end);
        dirty = true;
      }
      if (flags & F_PUSH) deliver();
    }
    // ID_DMX (254), ID_CONFIG/ID_CONTROL writes: accepted, not mapped
  });
  sock.bind(port, host);

  return { sock, stats, url: `udp://${host}:${port}`, close: () => { try { sock.close(); } catch {} } };
}
