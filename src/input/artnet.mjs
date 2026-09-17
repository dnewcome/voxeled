// Art-Net receiver — voxeled as an Art-Net node. ArtDmx (0x5000) hands each universe's channels
// to onDmx; ArtSync (0x5200) → onSync (senders that sync frames across universes); ArtPoll
// (0x2000) gets an ArtPollReply so consoles and senders discover the hub as a node.
import dgram from "node:dgram";
import os from "node:os";

const HEADER = Buffer.from("Art-Net\0", "latin1");
export const OP_DMX = 0x5000, OP_POLL = 0x2000, OP_POLL_REPLY = 0x2100, OP_SYNC = 0x5200;

export function parseArtNet(msg) {
  if (msg.length < 12 || !msg.subarray(0, 8).equals(HEADER)) return null;
  const op = msg.readUInt16LE(8);
  if (op === OP_DMX) {
    if (msg.length < 18) return null;
    const universe = msg.readUInt16LE(14) & 0x7fff, len = msg.readUInt16BE(16);
    return { op, universe, seq: msg[12], data: msg.subarray(18, 18 + Math.min(len, msg.length - 18)) };
  }
  return { op };
}

// Every Art-Net packet in a buffer (a WebSocket relay may concatenate several).
export function* eachArtNet(buf) {
  let o = 0;
  while (o + 12 <= buf.length) {
    const p = parseArtNet(buf.subarray(o));
    if (!p) return;
    yield p;
    o += p.op === OP_DMX ? 18 + p.data.length + (p.data.length & 1) : buf.length; // only ArtDmx has a length to skip by
  }
}

export function artPollReply({ ip = [127, 0, 0, 1], port = 6454, shortName = "voxeled", longName = "voxeled hub", universes = 0 } = {}) {
  const b = Buffer.alloc(239);
  HEADER.copy(b, 0); b.writeUInt16LE(OP_POLL_REPLY, 8);
  Buffer.from(ip).copy(b, 10); b.writeUInt16LE(port, 14);
  b[16] = 0; b[17] = 1;                                   // version
  b[26] = 0x70;                                           // ESTA manufacturer (unassigned)
  b.write(shortName.slice(0, 17), 26, "latin1"); b.write(longName.slice(0, 63), 44, "latin1");
  b.write(`#0001 [0000] voxeled: ${universes} universe(s) in`.slice(0, 63), 108, "latin1");
  b[172] = 0; b[173] = Math.min(4, universes) & 0xff;      // NumPorts
  for (let i = 0; i < Math.min(4, universes); i++) { b[174 + i] = 0x80; b[178 + i] = 0x80; }  // port type: output from Art-Net (DMX512), good input
  b[200] = 0x00;                                           // style: node
  return b;
}

export function createArtNetInput({ port = 6454, host = "0.0.0.0", onDmx, onSync, name = "voxeled" } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const stats = { packets: 0, universes: new Set(), lastAt: 0, polls: 0 };
  sock.on("message", (msg, rinfo) => {
    const p = parseArtNet(msg);
    if (!p) return;
    if (p.op === OP_DMX) { stats.packets++; stats.universes.add(p.universe); stats.lastAt = Date.now(); onDmx?.(p.universe, p.data, p.seq); }
    else if (p.op === OP_SYNC) onSync?.();
    else if (p.op === OP_POLL) {
      stats.polls++;
      const ip = (Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address || "127.0.0.1").split(".").map(Number);
      sock.send(artPollReply({ ip, port, shortName: name, universes: stats.universes.size }), rinfo.port, rinfo.address);
    }
  });
  sock.bind(port, host);
  return { sock, stats, url: `udp://${host}:${port}`, close: () => { try { sock.close(); } catch {} } };
}
