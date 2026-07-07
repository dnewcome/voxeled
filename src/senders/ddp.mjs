// DDP (Distributed Display Protocol) sender over UDP. voxeled's preferred pixel transport:
// an offset-addressed flat framebuffer with a ~10-byte header — no 512-channel universe
// fragmentation, no DMX refresh cap. Real path: → WLED / FPP / Falcon / a film control box.
import dgram from "node:dgram";

const MAX_DATA = 1440; // keep each datagram inside a typical MTU
const FLAG_VER1 = 0x40;
const FLAG_PUSH = 0x01;
const ID_DISPLAY = 1; // default output device

export function createDDPSender({ host, port = 4048 } = {}) {
  const sock = dgram.createSocket("udp4");
  let seq = 1;

  function packet(offset, data, push) {
    const buf = Buffer.alloc(10 + data.length);
    buf[0] = FLAG_VER1 | (push ? FLAG_PUSH : 0);
    buf[1] = seq & 0x0f; // sequence 1..15 (0 = not used)
    buf[2] = 0; // data type: 0 = as-configured on the device (RGB)
    buf[3] = ID_DISPLAY;
    buf.writeUInt32BE(offset, 4); // byte offset into the framebuffer
    buf.writeUInt16BE(data.length, 8);
    Buffer.from(data).copy(buf, 10);
    return buf;
  }

  function send(rgb) {
    let off = 0;
    while (off < rgb.length) {
      const chunk = rgb.subarray(off, off + MAX_DATA);
      const push = off + chunk.length >= rgb.length;
      sock.send(packet(off, chunk, push), port, host);
      off += chunk.length;
    }
    seq = (seq % 15) + 1;
  }

  return { send, close: () => sock.close(), kind: "ddp", target: `${host}:${port}` };
}
