// The normalized pixel bus + a tiny static server, in one dependency-free Node process.
//
// This is what dissolves thread-3d's "had to be Electron" problem: the hub (Node) owns the
// UDP/Art-Net side, and browser visualizers subscribe to frames over a plain WebSocket. So a
// viewer is just a web page, and any number of them see the exact same frames as the fixtures.
//
// Minimal RFC-6455 server: HTTP upgrade + unmasked binary broadcast frames. No external deps.
import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const accept = (key) => crypto.createHash("sha1").update(key + WS_GUID).digest("base64");

// Encode a server->client frame (FIN + opcode, unmasked). 0x2 = binary (pixel frames), 0x1 = text
// (JSON control messages, e.g. "the scene changed — refetch it").
function encodeFrame(payload, opcode) {
  const n = payload.length, first = 0x80 | opcode;
  let header;
  if (n < 126) {
    header = Buffer.from([first, n]);
  } else if (n < 65536) {
    header = Buffer.alloc(4);
    header[0] = first; header[1] = 126; header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first; header[1] = 127; header.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([header, payload]);
}
const encodeBinary = (payload) => encodeFrame(payload, 0x2);
const encodeText = (str) => encodeFrame(Buffer.from(str, "utf8"), 0x1);

// routes: [{ path, file?, content?, contentType }]. `content` may be a Buffer/string served from memory.
// Decode client→server frames (masked per RFC 6455). Handles frames split across TCP chunks and
// fragmented messages; ping → pong; close → close. Calls onFrame(opcode, payload) per message.
function frameParser(onFrame) {
  let buf = Buffer.alloc(0), frag = null, fragOp = 0;
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, o = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
      const need = o + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(o + (masked ? 4 : 0), need);
      if (masked) { const k = buf.subarray(o, o + 4), out = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ k[i & 3]; payload = out; }
      else payload = Buffer.from(payload);
      buf = buf.subarray(need);
      if (op === 0x0 || (!fin && (op === 0x1 || op === 0x2))) { // fragment
        if (op !== 0x0) { frag = [payload]; fragOp = op; } else frag?.push(payload);
        if (fin && frag) { onFrame(fragOp, Buffer.concat(frag)); frag = null; }
        continue;
      }
      onFrame(op, payload);
    }
  };
}

// onMessage({ socket, binary }) for binary client messages, onMessage({ socket, text }) for text —
// how a page pushes frames (raw RGB or Art-Net packets) and control JSON into the hub.
export function createBus({ port = 8080, wsPath = "/bus", routes = [], staticDir = null, onMessage = null } = {}) {
  const clients = new Set();
  const staticRoot = staticDir ? path.resolve(staticDir) : null;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");

    // Explicit routes take precedence (in-memory content, handlers).
    const route = routes.find((r) => r.path === u.pathname);
    if (route) {
      if (route.handler) { route.handler(req, res, u.searchParams); return; }
      let body;
      try {
        body = route.content != null ? route.content : readFileSync(route.file);
      } catch (e) {
        res.writeHead(500); res.end(String(e)); return;
      }
      res.writeHead(200, { "Content-Type": route.contentType || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }

    // Static files from staticDir (e.g. the viewer + its vendored three.js).
    if (staticRoot) {
      let rel = decodeURIComponent(u.pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      const resolved = path.resolve(path.join(staticRoot, rel));
      if (resolved === staticRoot || resolved.startsWith(staticRoot + path.sep)) {
        try {
          if (existsSync(resolved) && statSync(resolved).isFile()) {
            res.writeHead(200, { "Content-Type": MIME[path.extname(resolved)] || "application/octet-stream", "Cache-Control": "no-store" });
            res.end(readFileSync(resolved));
            return;
          }
        } catch { /* fall through to 404 */ }
      }
    }

    res.writeHead(404);
    res.end("not found");
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
    socket.on("data", frameParser((op, payload) => {
      if (op === 0x8) { try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch {} socket.end(); }
      else if (op === 0x9) { if (socket.writable) socket.write(encodeFrame(payload, 0xa)); }
      else if (op === 0x2 && onMessage) { try { onMessage({ socket, binary: payload }); } catch (e) { console.warn("bus: message handler", e.message); } }
      else if (op === 0x1 && onMessage) { try { onMessage({ socket, text: payload.toString("utf8") }); } catch (e) { console.warn("bus: message handler", e.message); } }
    }));
  });

  server.listen(port);

  function broadcast(payload) {
    if (!clients.size) return;
    const frame = encodeBinary(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength));
    for (const s of clients) { if (s.writable) s.write(frame); }
  }
  // JSON control message to every viewer (text frame) — e.g. { type: "scene" } after a layout edit.
  function broadcastText(obj) {
    if (!clients.size) return;
    const frame = encodeText(typeof obj === "string" ? obj : JSON.stringify(obj));
    for (const s of clients) { if (s.writable) s.write(frame); }
  }

  // The LAN address — what a phone on the same Wi-Fi can reach (first non-internal IPv4).
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  // Text to ONE client (a reply / status to whoever sent something).
  const sendText = (socket, obj) => { if (socket.writable) socket.write(encodeText(typeof obj === "string" ? obj : JSON.stringify(obj))); };

  return {
    broadcast,
    broadcastText,
    sendText,
    clients,
    server,
    url: `http://localhost:${port}/`,
    lanUrl: lanIp ? `http://${lanIp}:${port}/` : null,
    close: () => { for (const s of clients) s.destroy(); server.close(); },
  };
}
