// TCP color input: length-prefixed frames must survive partial reads and coalesced writes, and a
// received frame must reach the dispatcher unchanged (drive-from-external end to end).
import net from "node:net";
import dgram from "node:dgram";
import { createColorInput } from "../src/input/color-tcp.mjs";
import { createDispatcher } from "../src/output/dispatch.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const safety = setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 8000);
const frame = (bytes) => { const b = Buffer.from(bytes); const h = Buffer.alloc(4); h.writeUInt32BE(b.length, 0); return Buffer.concat([h, b]); };

// ── framing ──────────────────────────────────────────────────────────────────
const received = [];
const input = createColorInput({ port: 0, host: "127.0.0.1", onFrame: (rgb) => received.push(Buffer.from(rgb)) });
await new Promise((r) => (input.server.listening ? r() : input.server.once("listening", r)));
const port = input.server.address().port;

await new Promise((resolve) => {
  const c = net.connect(port, "127.0.0.1", () => {
    const fA = frame([1, 2, 3, 4, 5, 6]);
    c.write(fA.subarray(0, 7));                 // 4-byte length + first 3 payload bytes …
    setTimeout(() => c.write(fA.subarray(7)), 20); // … rest of the frame later (partial read)
    setTimeout(() => c.write(Buffer.concat([frame([10, 11, 12]), frame([20, 21, 22, 23, 24, 25])])), 60); // two frames, one write
    setTimeout(() => { c.end(); resolve(); }, 160);
  });
});

ok(received.length === 3, `3 frames received (got ${received.length})`);
ok(received[0]?.equals(Buffer.from([1, 2, 3, 4, 5, 6])), "frame split across two writes is reassembled");
ok(received[1]?.equals(Buffer.from([10, 11, 12])), "first of two coalesced frames");
ok(received[2]?.equals(Buffer.from([20, 21, 22, 23, 24, 25])), "second of two coalesced frames");
input.close();

// ── end to end: TCP frame → dispatcher → Art-Net packet ─────────────────────
await new Promise((resolve) => {
  const scene = {
    voxeled: "0.0.1", units: "mm", count: 2,
    meta: { instances: [{ name: "a", output: { protocol: "artnet", host: "127.0.0.1", port: 16010, universe: 0, byteOrder: "rgb" } }] },
    pixels: [{ i: 0, inst: 0, p: [0, 0, 0], n: [0, 0, 1] }, { i: 1, inst: 0, p: [0, 0, 0], n: [0, 0, 1] }],
  };
  const disp = createDispatcher(scene);
  const rx = dgram.createSocket("udp4");
  rx.on("message", (msg) => {
    ok(msg.slice(0, 8).toString("latin1") === "Art-Net\0", "TCP color frame drove an Art-Net packet");
    ok(msg[18] === 200 && msg[19] === 100 && msg[20] === 50, "pixel color arrived intact (200,100,50)");
    rx.close(); disp.close(); resolve();
  });
  rx.bind(16010, "127.0.0.1", () => {
    const inp = createColorInput({ port: 0, host: "127.0.0.1", onFrame: (rgb) => disp.send(rgb) });
    inp.server.once("listening", () => {
      const p = inp.server.address().port;
      const c = net.connect(p, "127.0.0.1", () => c.write(frame([200, 100, 50, 0, 0, 0])));
    });
  });
});

clearTimeout(safety);
console.log(`color-input: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
