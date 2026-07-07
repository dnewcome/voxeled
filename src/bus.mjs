// The normalized pixel bus + a tiny static server, in one dependency-free Node process.
//
// This is what dissolves thread-3d's "had to be Electron" problem: the hub (Node) owns the
// UDP/Art-Net side, and browser visualizers subscribe to frames over a plain WebSocket. So a
// viewer is just a web page, and any number of them see the exact same frames as the fixtures.
//
// Minimal RFC-6455 server: HTTP upgrade + unmasked binary broadcast frames. No external deps.
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const accept = (key) => crypto.createHash("sha1").update(key + WS_GUID).digest("base64");

// Encode a server->client binary frame (FIN + opcode 0x2, unmasked).
function encodeBinary(payload) {
  const n = payload.length;
  let header;
  if (n < 126) {
    header = Buffer.from([0x82, n]);
  } else if (n < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82; header[1] = 126; header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82; header[1] = 127; header.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([header, payload]);
}

// routes: [{ path, file?, content?, contentType }]. `content` may be a Buffer/string served from memory.
export function createBus({ port = 8080, wsPath = "/bus", routes = [] } = {}) {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const route = routes.find((r) => r.path === u.pathname);
    if (!route) { res.writeHead(404); res.end("not found"); return; }
    if (route.handler) { route.handler(req, res, u.searchParams); return; } // control endpoints
    let body;
    try {
      body = route.content != null ? route.content : readFileSync(route.file);
    } catch (e) {
      res.writeHead(500); res.end(String(e)); return;
    }
    res.writeHead(200, { "Content-Type": route.contentType || "application/octet-stream" });
    res.end(body);
  });

  server.on("upgrade", (req, socket) => {
    if (req.url.split("?")[0] !== wsPath) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`
    );
    socket.setNoDelay(true);
    clients.add(socket);
    const drop = () => clients.delete(socket);
    socket.on("close", drop);
    socket.on("error", drop);
    // Respond to a client close frame (opcode 0x8) by ending; otherwise ignore inbound data.
    socket.on("data", (buf) => { if ((buf[0] & 0x0f) === 0x8) socket.end(); });
  });

  server.listen(port);

  function broadcast(payload) {
    if (!clients.size) return;
    const frame = encodeBinary(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength));
    for (const s of clients) { if (s.writable) s.write(frame); }
  }

  return {
    broadcast,
    clients,
    server,
    url: `http://localhost:${port}/`,
    close: () => { for (const s of clients) s.destroy(); server.close(); },
  };
}
