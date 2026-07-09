// Patch dispatcher — the runtime that executes a scene's output mapping. Each fixture instance
// carries an `output` patch (protocol + address); the dispatcher groups pixels by instance, packs
// them per byte-order, and fans them out to the right protocol — so ONE scene can drive Art-Net,
// DDP, and dan-mx fixtures at once. Custom protocols plug in via `customProtocols`.
import dgram from "node:dgram";
import { artDmxPacket } from "../senders/artnet.mjs";
import { ddpPacket } from "../senders/ddp.mjs";
import { DanmxStream, danmxOpts } from "../senders/danmx.mjs";

// Byte orders: index into source [r,g,b]; -1 = white = min(r,g,b).
const ORDERS = {
  rgb: [0, 1, 2], grb: [1, 0, 2], bgr: [2, 1, 0], rbg: [0, 2, 1], brg: [2, 0, 1], gbr: [1, 2, 0],
  rgbw: [0, 1, 2, -1], grbw: [1, 0, 2, -1],
};

export function createDispatcher(scene, { customProtocols = {} } = {}) {
  const instances = scene.meta?.instances || [];
  const groups = instances.map(() => []);
  for (const px of scene.pixels) { const g = groups[px.inst || 0]; if (g) g.push(px.i); }

  const plans = [];
  instances.forEach((inst, k) => {
    const o = inst.output;
    if (!o || !o.protocol || !o.host) return;
    const protocol = String(o.protocol).toLowerCase();
    plans.push({
      name: inst.name || `inst-${k}`,
      protocol,
      indices: groups[k],
      host: o.host,
      port: o.port,
      universe: o.universe | 0,
      channel: Math.max(0, (o.channel || 1) - 1),
      offset: o.offset | 0,
      startPixel: o.startPixel | 0,
      order: ORDERS[String(o.byteOrder || "rgb").toLowerCase()] || ORDERS.rgb,
      // dan-mx keeps a stateful stream (RLE/DELTA need a reference across frames)
      stream: protocol === "danmx" ? new DanmxStream({ ...danmxOpts(o), startPixel: o.startPixel | 0 }) : null,
    });
  });

  const sock = dgram.createSocket("udp4");
  let seq = 1;

  const pack = (indices, rgb, order) => {
    const cpp = order.length;
    const out = Buffer.allocUnsafe(indices.length * cpp);
    let o = 0;
    for (const i of indices) {
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      for (const c of order) out[o++] = c === -1 ? Math.min(r, g, b) : c === 0 ? r : c === 1 ? g : b;
    }
    return out;
  };

  function send(rgb) {
    const artnet = new Map(); // "host:port" -> { host, port, unis: Map<universe, Buffer(512)> }
    const ddp = new Map(); //    "host:port" -> { host, port, buf: Buffer }

    for (const p of plans) {
      if (p.protocol === "artnet") {
        const bytes = pack(p.indices, rgb, p.order);
        const port = p.port || 6454, key = `${p.host}:${port}`;
        let a = artnet.get(key); if (!a) { a = { host: p.host, port, unis: new Map() }; artnet.set(key, a); }
        let u = p.universe, ch = p.channel, off = 0; // fill channels, rolling across universes
        while (off < bytes.length) {
          let ub = a.unis.get(u); if (!ub) { ub = Buffer.alloc(512); a.unis.set(u, ub); }
          const len = Math.min(512 - ch, bytes.length - off);
          bytes.copy(ub, ch, off, off + len); off += len; ch = 0; u++;
        }
      } else if (p.protocol === "ddp") {
        const bytes = pack(p.indices, rgb, p.order);
        const port = p.port || 4048, key = `${p.host}:${port}`;
        let d = ddp.get(key); if (!d) { d = { host: p.host, port, buf: Buffer.alloc(0) }; ddp.set(key, d); }
        const end = p.offset + bytes.length;
        if (d.buf.length < end) { const nb = Buffer.alloc(end); d.buf.copy(nb); d.buf = nb; }
        bytes.copy(d.buf, p.offset);
      } else if (p.protocol === "danmx") {
        for (const wire of p.stream.frames(pack(p.indices, rgb, ORDERS.rgb), seq)) sock.send(wire, p.port || 6454, p.host);
      } else if (customProtocols[p.protocol]) {
        customProtocols[p.protocol](sock, p, pack(p.indices, rgb, p.order), seq);
      }
      // unknown protocols are skipped (register them via customProtocols)
    }

    for (const a of artnet.values())
      for (const [u, ub] of a.unis) sock.send(artDmxPacket(u, seq, ub), a.port, a.host);
    for (const d of ddp.values()) {
      let off = 0;
      while (off < d.buf.length) {
        const chunk = d.buf.subarray(off, off + 1440);
        sock.send(ddpPacket(off, chunk, off + chunk.length >= d.buf.length, seq), d.port, d.host);
        off += chunk.length;
      }
    }
    seq = (seq % 255) + 1;
  }

  const summary = plans.map((p) =>
    `${p.name}·${p.protocol}→${p.host}${p.protocol === "artnet" ? `/u${p.universe}` : p.protocol === "ddp" ? `@${p.offset}` : ""}`);

  return { send, plans, summary, kind: "dispatch", close: () => { try { sock.close(); } catch {} } };
}
