// Art-Net (ArtDMX) over UDP. `artDmxPacket` is the reusable packet builder (also used by the
// patch dispatcher); `createArtNetSender` is the simple whole-frame sender used by the demo's
// global ARTNET= path and its tests.
import dgram from "node:dgram";

const HEADER = Buffer.from("Art-Net\0", "latin1");
const CH_PER_UNIVERSE = 510; // 170 RGB pixels, even byte count

// Build one ArtDMX packet for `universe` carrying `data` (≤512 channel bytes).
export function artDmxPacket(universe, seq, data) {
  const len = data.length + (data.length & 1); // Art-Net length must be even
  const buf = Buffer.alloc(18 + len);
  HEADER.copy(buf, 0);
  buf.writeUInt16LE(0x5000, 8); // OpOutput / ArtDMX
  buf.writeUInt16BE(14, 10); // protocol version 14
  buf[12] = seq & 0xff; // sequence
  buf[13] = 0; // physical
  buf[14] = universe & 0xff; // sub-universe
  buf[15] = (universe >> 8) & 0x7f; // net
  buf.writeUInt16BE(len, 16); // data length
  Buffer.from(data).copy(buf, 18);
  return buf;
}

export function createArtNetSender({ host, port = 6454, universeBase = 0 } = {}) {
  const sock = dgram.createSocket("udp4");
  let seq = 1;
  function send(rgb) {
    let off = 0, universe = universeBase;
    while (off < rgb.length) {
      sock.send(artDmxPacket(universe, seq, rgb.subarray(off, off + CH_PER_UNIVERSE)), port, host);
      off += CH_PER_UNIVERSE;
      universe++;
    }
    seq = (seq % 255) + 1;
  }
  return { send, close: () => sock.close(), kind: "artnet", target: `${host}:${port}` };
}
