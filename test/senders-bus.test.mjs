// Output paths: Art-Net + DDP packet framing, and the WebSocket bus (handshake + frame delivery).
import dgram from "node:dgram";
import net from "node:net";
import crypto from "node:crypto";
import { generateScene } from "../examples/mobius-heart/map.mjs";
import { createHub } from "../src/hub.mjs";
import { createBus } from "../src/bus.mjs";
import { createArtNetSender } from "../src/senders/artnet.mjs";
import { createDDPSender } from "../src/senders/ddp.mjs";
import { PATTERNS } from "../src/patterns.mjs";

const scene = generateScene({ pitchMM: 40 }); // small: 288 px → 864 bytes
const N = scene.count, BYTES = N * 3;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
console.log(`senders-bus: ${N} px, ${BYTES} bytes/frame`);

await new Promise((resolve) => {
  const AP = 16454;
  const rx = dgram.createSocket("udp4");
  const seen = [];
  rx.on("message", (msg) => {
    seen.push(msg);
    if (seen.length === Math.ceil(BYTES / 510)) {
      ok(msg.slice(0, 8).toString("latin1") === "Art-Net\0", "Art-Net header");
      ok(seen[0].readUInt16LE(8) === 0x5000, "Art-Net opcode 0x5000");
      ok(seen[0].readUInt16BE(10) === 14, "Art-Net protocol version 14");
      ok(seen[0][15] === 0 && seen[0][14] === 0, "first universe = 0");
      ok(seen[1] && seen[1][14] === 1, "second universe = 1");
      const total = seen.reduce((a, m) => a + m.readUInt16BE(16), 0);
      ok(total >= BYTES, `universes cover all ${BYTES} bytes`);
      rx.close(); resolve();
    }
  });
  rx.bind(AP, "127.0.0.1", () => {
    createHub({ scene, pattern: PATTERNS.ribbonChase(), senders: [createArtNetSender({ host: "127.0.0.1", port: AP })] }).renderOnce();
  });
});

await new Promise((resolve) => {
  const DP = 14048;
  const rx = dgram.createSocket("udp4");
  rx.on("message", (msg) => {
    ok((msg[0] & 0x40) !== 0, "DDP version1 flag");
    ok((msg[0] & 0x01) !== 0, "DDP PUSH flag (single packet)");
    ok(msg[3] === 1, "DDP destination id = 1");
    ok(msg.readUInt32BE(4) === 0, "DDP data offset = 0");
    ok(msg.readUInt16BE(8) === BYTES, `DDP data length = ${BYTES}`);
    ok(msg.length === 10 + BYTES, "DDP packet = 10-byte header + data");
    rx.close(); resolve();
  });
  rx.bind(DP, "127.0.0.1", () => {
    createHub({ scene, pattern: PATTERNS.ribbonChase(), senders: [createDDPSender({ host: "127.0.0.1", port: DP })] }).renderOnce();
  });
});

await new Promise((resolve) => {
  const PORT = 18099;
  const bus = createBus({ port: PORT });
  const hub = createHub({ scene, pattern: PATTERNS.planeSweep(), bus, fps: 30 });
  const key = crypto.randomBytes(16).toString("base64");
  const expect = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const sock = net.connect(PORT, "127.0.0.1", () => {
    sock.write(`GET /bus HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    hub.start();
  });
  let buf = Buffer.alloc(0), handshook = false;
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!handshook) {
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      const head = buf.slice(0, i).toString();
      ok(head.startsWith("HTTP/1.1 101"), "bus returns 101 Switching Protocols");
      ok(head.includes(`Sec-WebSocket-Accept: ${expect}`), "correct Sec-WebSocket-Accept");
      buf = buf.slice(i + 4); handshook = true;
    }
    if (handshook && buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      if (buf.length >= off + len) {
        ok(opcode === 0x2, "frame opcode = binary");
        ok((buf[1] & 0x80) === 0, "server frame unmasked");
        ok(len === BYTES, `frame payload = ${BYTES} bytes`);
        hub.stop(); bus.close(); sock.destroy(); resolve();
      }
    }
  });
});

// Large frame (>65535 bytes) exercises the 64-bit WebSocket length path — used by big rigs
// like the 3×3 grid (28,800 px → 86,400 bytes/frame).
await new Promise((resolve) => {
  const PORT = 18100;
  const bus = createBus({ port: PORT });
  const BIG = 90000;
  const payload = new Uint8Array(BIG);
  for (let i = 0; i < BIG; i++) payload[i] = i & 0xff;
  const key = crypto.randomBytes(16).toString("base64");
  const sock = net.connect(PORT, "127.0.0.1", () => {
    sock.write(`GET /bus HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
  let buf = Buffer.alloc(0), hs = false;
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!hs) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; buf = buf.slice(i + 4); hs = true; bus.broadcast(payload); return; }
    if (buf.length < 2) return;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length >= off + len) {
      ok((buf[1] & 0x7f) === 127, "large frame uses 64-bit length marker (127)");
      ok(len === BIG, `decoded length = ${BIG} bytes`);
      ok(buf[off] === 0 && buf[off + 255] === 255, "payload bytes intact");
      bus.close(); sock.destroy(); resolve();
    }
  });
});

console.log(`senders-bus: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
