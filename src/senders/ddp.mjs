// DDP (Distributed Display Protocol) over UDP. `ddpPacket` is the reusable builder (also used by
// the patch dispatcher); `createDDPSender` is the simple whole-frame sender.
import dgram from "node:dgram";

const MAX_DATA = 1440; // keep each datagram inside a typical MTU
const FLAG_VER1 = 0x40;
const FLAG_PUSH = 0x01;
const ID_DISPLAY = 1;

// Build one DDP packet writing `data` at byte `offset` into the receiver's framebuffer.
export function ddpPacket(offset, data, push, seq) {
  const buf = Buffer.alloc(10 + data.length);
  buf[0] = FLAG_VER1 | (push ? FLAG_PUSH : 0);
  buf[1] = seq & 0x0f;
  buf[2] = 0; // data type: as-configured on device (RGB)
  buf[3] = ID_DISPLAY;
  buf.writeUInt32BE(offset, 4);
  buf.writeUInt16BE(data.length, 8);
  Buffer.from(data).copy(buf, 10);
  return buf;
}

export function createDDPSender({ host, port = 4048 } = {}) {
  const sock = dgram.createSocket("udp4");
  let seq = 1;
  function send(rgb) {
    let off = 0;
    while (off < rgb.length) {
      const chunk = rgb.subarray(off, off + MAX_DATA);
      sock.send(ddpPacket(off, chunk, off + chunk.length >= rgb.length, seq), port, host);
      off += chunk.length;
    }
    seq = (seq % 15) + 1;
  }
  return { send, close: () => sock.close(), kind: "ddp", target: `${host}:${port}` };
}
