// TCP color input — the receiving end of "drive voxeled from an external tool" (e.g. TiXL's
// VoxeledOutput operator). An external source streams per-pixel colors in scene order; voxeled
// hands each frame to the patch dispatcher, so the sender never needs to know the protocols.
//
// Wire: length-prefixed frames over TCP — [uint32 BE byteLength][byteLength bytes of RGB]. TCP
// (not UDP) so a full frame arrives intact regardless of size; latest frame wins (we just call
// onFrame as frames complete).
import net from "node:net";

const MAX_FRAME = 64 * 1024 * 1024; // sanity cap

export function createColorInput({ port = 9600, host = "0.0.0.0", onFrame } = {}) {
  let clients = 0;
  const server = net.createServer((sock) => {
    clients++;
    sock.setNoDelay(true);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len > MAX_FRAME) { sock.destroy(); return; }
        if (buf.length < 4 + len) break; // wait for the rest of the frame
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        try { onFrame?.(new Uint8Array(frame)); } catch { /* keep the stream alive */ }
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => { clients--; });
  });
  server.on("error", (e) => { throw e; });
  server.listen(port, host);

  return {
    server,
    get clients() { return clients; },
    url: `tcp://${host}:${port}`,
    close: () => { try { server.close(); } catch {} },
  };
}
