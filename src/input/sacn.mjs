// sACN / E1.31 receiver — the standards-body cousin of Art-Net (multicast, per-packet PRIORITY).
// Parses the E1.31 data packet (root → framing → DMP layers) and hands universe, channels and the
// sender's priority to onDmx; joins the per-universe multicast groups you name (239.255.hi.lo).
import dgram from "node:dgram";

const ACN_ID = Buffer.from("ASC-E1.17\0\0\0", "latin1");

export function parseSacn(msg) {
  if (msg.length < 126 || msg.readUInt16BE(0) !== 0x0010 || !msg.subarray(4, 16).equals(ACN_ID)) return null;
  if (msg.readUInt32BE(18) !== 0x00000004 || msg.readUInt32BE(40) !== 0x00000002) return null; // E1.31 data
  const name = msg.subarray(44, 108).toString("latin1").replace(/\0.*$/, "");
  const priority = msg[108], seq = msg[111], universe = msg.readUInt16BE(113);
  const count = msg.readUInt16BE(123); // property values incl. the start code
  const start = msg[125];
  return { universe, priority, seq, name, startCode: start, data: msg.subarray(126, 126 + Math.max(0, Math.min(count - 1, msg.length - 126))) };
}

export function sacnPacket({ universe, data, priority = 100, seq = 0, name = "voxeled", cid = Buffer.alloc(16, 7) }) {
  const n = data.length + 1, b = Buffer.alloc(126 + data.length);
  b.writeUInt16BE(0x0010, 0); b.writeUInt16BE(0, 2); ACN_ID.copy(b, 4);
  b.writeUInt16BE(0x7000 | (b.length - 16), 16); b.writeUInt32BE(4, 18); cid.copy(b, 22);
  b.writeUInt16BE(0x7000 | (b.length - 38), 38); b.writeUInt32BE(2, 40); b.write(name.slice(0, 63), 44, "latin1");
  b[108] = priority; b[111] = seq; b.writeUInt16BE(universe, 113);
  b.writeUInt16BE(0x7000 | (b.length - 115), 115); b[117] = 2; b[118] = 0xa1; b.writeUInt16BE(0, 119); b.writeUInt16BE(1, 121); b.writeUInt16BE(n, 123);
  b[125] = 0; Buffer.from(data).copy(b, 126);
  return b;
}

export function createSacnInput({ port = 5568, host = "0.0.0.0", universes = [], onDmx } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const stats = { packets: 0, universes: new Set(), lastAt: 0 };
  sock.on("message", (msg) => {
    const p = parseSacn(msg);
    if (!p || p.startCode !== 0) return;
    stats.packets++; stats.universes.add(p.universe); stats.lastAt = Date.now();
    onDmx?.(p.universe, p.data, p.seq, p.priority);
  });
  sock.bind(port, host, () => { for (const u of universes) { try { sock.addMembership(`239.255.${(u >> 8) & 0xff}.${u & 0xff}`); } catch {} } });
  return { sock, stats, url: `udp://${host}:${port}`, close: () => { try { sock.close(); } catch {} } };
}
