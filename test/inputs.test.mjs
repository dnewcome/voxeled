// Inputs + merge: the input map (Thread/luxpi wiring as data, segments, sequential), the sources
// merge (priority / htp / ltp, timeouts, fallback), the Art-Net and sACN receivers over loopback
// UDP (incl. ArtPoll discovery), the bus's inbound WebSocket frames (masked, chunked, fragmented),
// and end to end: a hub with `inputs:` driven by Art-Net + a page over the bus at once.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInputMap } from "../src/input/map.mjs";
import { createSources } from "../src/input/sources.mjs";
import { createArtNetInput, parseArtNet, eachArtNet, OP_POLL, OP_DMX } from "../src/input/artnet.mjs";
import { createSacnInput, sacnPacket, parseSacn } from "../src/input/sacn.mjs";
import { artDmxPacket } from "../src/senders/artnet.mjs";
import { createBus } from "../src/bus.mjs";
import { resolveInputs } from "../src/layout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const freeUdp = () => new Promise((res) => { const s = dgram.createSocket("udp4"); s.bind(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

// ── input map ──────────────────────────────────────────────────────────────────
const N = 7200;
const thread = (extra = {}) => buildInputMap({ strings: 12, universesPerString: 4, perUniverse: 150, ...extra }, N);
let m = thread({ stripB: "doc" });
const px = (map, u, j) => map.table.get(u)[j];
ok(m.universes.length === 48 && m.covered === 7200, "Thread: 48 universes cover all 7,200 px");
ok(px(m, 0, 0) === 0 && px(m, 1, 0) === 150 && px(m, 1, 149) === 299, "strip A: universes 0-1 run pixels 0…299 in order");
ok(px(m, 2, 0) === 599 && px(m, 2, 149) === 450 && px(m, 3, 0) === 449 && px(m, 3, 149) === 300, "strip B `doc`: universe 2 → 599…450, universe 3 → 449…300 (luxpi PATTERNS.md)");
m = thread({ stripB: "luxpi" });
ok(px(m, 2, 0) === 449 && px(m, 2, 149) === 300 && px(m, 3, 0) === 599 && px(m, 3, 149) === 450, "strip B `luxpi`: each universe reversed within its own 150 (artnet_publisher.py / the page's table)");
m = thread({ stripB: "none" });
ok(px(m, 2, 0) === 300 && px(m, 3, 149) === 599, "strip B `none`: straight 0…599");
m = thread({ flip: true });
ok(px(m, 0, 0) === 599 && px(m, 2, 0) === 0, "flip: LED 0 is at the other pedestal");
m = thread({ groups: { size: 3, order: [2, 0, 1, 3] } });
ok(px(m, 0, 0) === 6 * 600 && px(m, 12, 0) === 0 && px(m, 24, 0) === 3 * 600 && px(m, 36, 0) === 9 * 600, "groups.order: luxpi strand X → tube 2, Y → tube 0, Z → tube 1, W → spine");
m = thread({ universe: 10, pixel: 100 });
ok(px(m, 10, 0) === 100 && m.universes[0] === 10, "universe / pixel base offsets");
m = buildInputMap({ segments: [{ universe: 5, channel: 1, pixel: 10, count: 4 }, { universe: 5, channel: 13, pixel: 23, count: 4, dir: -1 }] }, 100);
ok(px(m, 5, 0) === 10 && px(m, 5, 3) === 13 && px(m, 5, 4) === 23 && px(m, 5, 7) === 20 && m.covered === 8, "segments: explicit runs, forward and reversed, from a channel");
m = buildInputMap({}, 400);
ok(m.universes.length === 3 && px(m, 1, 0) === 170 && px(m, 2, 59) === 399 && m.covered === 400, "default: sequential 170 px per universe");
let threw = ""; try { buildInputMap({ strings: 2, stripB: "x" }, 10); } catch (e) { threw = e.message; }
ok(/doc \| luxpi \| none/.test(threw), "bad stripB is a clear error");

// ── sources merge ──────────────────────────────────────────────────────────────
{
  const S = createSources({ N: 4, mode: "priority", fallback: "show", timeoutMs: 80 });
  const hi = S.add("hi", { priority: 100 }), lo = S.add("lo", { priority: 10 });
  const out = new Uint8Array(12);
  const base = (o) => o.fill(7);
  let r = S.compose(out, base);
  ok(r.live.length === 0 && out.every((v) => v === 7), "no live source → the show renders everywhere");
  lo.writeFrame(new Uint8Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]));
  r = S.compose(out, base);
  ok(r.live.join() === "lo" && out[0] === 1 && out[9] === 4 && r.covered === 4, "one live source drives every pixel it wrote");
  const map = buildInputMap({ segments: [{ universe: 0, pixel: 1, count: 2 }] }, 4);
  hi.writeUniverse(map, 0, new Uint8Array([9, 9, 9, 8, 8, 8]));
  r = S.compose(out, base);
  ok(out[0] === 1 && out[3] === 9 && out[6] === 8 && out[9] === 4, "priority: the high source wins the pixels it covers (1-2), the low one keeps the rest");
  await sleep(100);
  r = S.compose(out, base);
  ok(r.live.length === 0 && out[3] === 7, "both time out → back to the show (failover)");
  const H = createSources({ N: 1, mode: "htp" });
  H.add("a", { priority: 1 }).writeFrame(new Uint8Array([10, 200, 0])); H.add("b", { priority: 2 }).writeFrame(new Uint8Array([100, 20, 5]));
  const o1 = new Uint8Array(3); H.compose(o1, null);
  ok(o1[0] === 100 && o1[1] === 200 && o1[2] === 5, "htp: per-channel max across live sources");
  const L = createSources({ N: 1, mode: "ltp" });
  const la = L.add("a", { priority: 100 }), lb = L.add("b", { priority: 1 });
  la.writeFrame(new Uint8Array([1, 1, 1])); lb.writeFrame(new Uint8Array([2, 2, 2]));
  const o2 = new Uint8Array(3); L.compose(o2, null);
  ok(o2[0] === 2, "ltp: the most recent write wins regardless of priority");
  la.writeFrame(new Uint8Array([3, 3, 3])); L.compose(o2, null);
  ok(o2[0] === 3, "…and flips back when the other writes again");
  const B = createSources({ N: 2, mode: "priority", fallback: "black" });
  B.add("a").writeUniverse(buildInputMap({ segments: [{ universe: 0, pixel: 0, count: 1 }] }, 2), 0, new Uint8Array([5, 5, 5]));
  const o3 = new Uint8Array(6).fill(9); B.compose(o3, (o) => o.fill(1));
  ok(o3[0] === 5 && o3[3] === 0, "fallback black: uncovered pixels go dark, not to the show");
  const K = createSources({ N: 2, mode: "priority", fallback: "hold" });
  const o4 = new Uint8Array(6).fill(9); K.compose(o4, (o) => o.fill(1));
  ok(o4[0] === 9, "fallback hold: nothing live → the last output stays");
  threw = ""; try { createSources({ N: 1, mode: "max" }); } catch (e) { threw = e.message; }
  ok(/priority \| htp \| ltp/.test(threw), "bad merge mode is a clear error");
  threw = ""; try { S.add("hi"); } catch (e) { threw = e.message; }
  ok(/duplicate/.test(threw), "duplicate input names are refused");
}

// ── Art-Net receiver (loopback UDP) ────────────────────────────────────────────
{
  const port = await freeUdp();
  const got = [];
  const inp = createArtNetInput({ port, host: "127.0.0.1", onDmx: (u, d, seq) => got.push({ u, d: Array.from(d.subarray(0, 3)), seq }) });
  await sleep(50);
  const tx = dgram.createSocket("udp4");
  await new Promise((r) => tx.bind(0, "127.0.0.1", r));
  tx.send(artDmxPacket(7, 3, new Uint8Array([1, 2, 3, 4])), port, "127.0.0.1");
  tx.send(artDmxPacket(300, 4, new Uint8Array([5, 6, 7])), port, "127.0.0.1");
  await sleep(80);
  ok(got.length === 2 && got[0].u === 7 && got[0].d.join() === "1,2,3" && got[0].seq === 3 && got[1].u === 300, `ArtDmx parsed: universe, data, seq (${JSON.stringify(got)})`);
  const poll = Buffer.concat([Buffer.from("Art-Net\0", "latin1"), Buffer.from([0x00, 0x20, 0, 14, 0, 0])]);
  const reply = await new Promise((res) => { tx.once("message", (msg) => res(msg)); tx.send(poll, port, "127.0.0.1"); });
  ok(reply.readUInt16LE(8) === 0x2100 && reply.length === 239 && reply.subarray(26, 33).toString("latin1") === "voxeled", "ArtPoll → ArtPollReply (239 bytes, short name voxeled): senders discover the hub");
  ok(inp.stats.packets === 2 && inp.stats.universes.size === 2 && inp.stats.polls === 1, "receiver stats");
  const two = Buffer.concat([artDmxPacket(1, 1, new Uint8Array([1, 1, 1])), artDmxPacket(2, 1, new Uint8Array([2, 2, 2]))]);
  ok([...eachArtNet(two)].map((p) => p.universe).join() === "1,2", "eachArtNet walks concatenated packets (a WebSocket relay)");
  ok(parseArtNet(Buffer.from("nope")) === null, "non-Art-Net is ignored");
  tx.close(); inp.close();
}

// ── sACN receiver ──────────────────────────────────────────────────────────────
{
  const port = await freeUdp();
  const got = [];
  const inp = createSacnInput({ port, host: "127.0.0.1", onDmx: (u, d, seq, pri) => got.push({ u, d: Array.from(d.subarray(0, 3)), pri }) });
  await sleep(50);
  const pkt = sacnPacket({ universe: 3, data: new Uint8Array([9, 8, 7, 6]), priority: 150, name: "console" });
  const p = parseSacn(pkt);
  ok(p && p.universe === 3 && p.priority === 150 && p.name === "console" && p.data.length === 4 && p.data[0] === 9, "E1.31 packet builds and parses (root/framing/DMP layers)");
  const tx = dgram.createSocket("udp4");
  tx.send(pkt, port, "127.0.0.1");
  await sleep(80);
  ok(got.length === 1 && got[0].u === 3 && got[0].pri === 150 && got[0].d.join() === "9,8,7", "sACN data lands with the sender's priority");
  tx.close(); inp.close();
}

// ── bus: inbound WebSocket frames ──────────────────────────────────────────────
const wsFrame = (payload, opcode = 0x2, fin = true) => {
  const n = payload.length, key = crypto.randomBytes(4), first = (fin ? 0x80 : 0) | opcode;
  const head = n < 126 ? Buffer.from([first, 0x80 | n]) : n < 65536 ? Buffer.concat([Buffer.from([first, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; })()]) : Buffer.concat([Buffer.from([first, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  const masked = Buffer.alloc(n); for (let i = 0; i < n; i++) masked[i] = payload[i] ^ key[i & 3];
  return Buffer.concat([head, key, masked]);
};
async function wsConnect(port, pathname = "/bus") {
  const sock = net.connect(port, "127.0.0.1");
  await new Promise((r) => sock.on("connect", r));
  sock.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  let buf = Buffer.alloc(0);
  await new Promise((res) => sock.on("data", function onData(d) { buf = Buffer.concat([buf, d]); const i = buf.indexOf("\r\n\r\n"); if (i >= 0) { sock.off("data", onData); buf = buf.subarray(i + 4); res(); } }));
  // server→client frames are unmasked; collect them
  const msgs = [];
  const parse = () => { for (;;) { if (buf.length < 2) return; const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, o = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; } if (buf.length < o + len) return; msgs.push({ op, payload: buf.subarray(o, o + len) }); buf = buf.subarray(o + len); } };
  parse();
  sock.on("data", (d) => { buf = Buffer.concat([buf, d]); parse(); });
  return { sock, msgs, send: (payload, opcode = 0x2, fin = true) => sock.write(wsFrame(payload, opcode, fin)) };
}
{
  const port = await freePort();
  const got = [];
  const bus = createBus({ port, onMessage: ({ binary, text }) => got.push(binary ? { bin: binary.length, first: binary[0], last: binary[binary.length - 1] } : { text }) });
  await sleep(50);
  const c = await wsConnect(port);
  c.send(Buffer.from("hi"));
  const big = Buffer.alloc(21600, 5); big[0] = 1; big[21599] = 2;
  const f = wsFrame(big);
  for (let o = 0; o < f.length; o += 1000) { c.sock.write(f.subarray(o, o + 1000)); await sleep(1); } // chunked over TCP
  c.send(Buffer.from('{"type":"x"}'), 0x1);
  c.send(Buffer.from("abc"), 0x2, false); c.send(Buffer.from("def"), 0x0, true);                       // fragmented
  await sleep(150);
  ok(got[0]?.bin === 2, "small binary message");
  ok(got[1]?.bin === 21600 && got[1].first === 1 && got[1].last === 2, "a 21,600-byte frame arriving in 1 KB chunks is reassembled and unmasked");
  ok(got[2]?.text === '{"type":"x"}', "text message");
  ok(got[3]?.bin === 6, "fragmented message is joined");
  c.send(Buffer.from("p"), 0x9);
  await sleep(50);
  ok(c.msgs.some((m) => m.op === 0xa), "ping → pong");
  c.sock.destroy(); bus.close();
}

// ── resolveInputs (layout validation) ──────────────────────────────────────────
{
  const r = resolveInputs([{ protocol: "artnet", map: { strings: 12 } }, { name: "web", protocol: "ws", priority: 5 }, { protocol: "sacn", universes: [1, 2] }]);
  ok(r[0].name === "artnet" && r[0].port === 6454 && r[1].port === undefined && r[2].port === 5568 && r[2].universes.length === 2, "defaults: name = protocol, standard ports, ws has none");
  threw = ""; try { resolveInputs([{ protocol: "osc" }]); } catch (e) { threw = e.message; }
  ok(/protocol must be one of/.test(threw), "unknown protocol is a clear error");
  threw = ""; try { resolveInputs([{ protocol: "ws" }, { protocol: "ws" }]); } catch (e) { threw = e.message; }
  ok(/duplicate/.test(threw), "duplicate names are refused");
}

// ── end to end: a hub with inputs, driven by Art-Net + a page over the bus at once ──
{
  const httpPort = await freePort(), artPort = await freeUdp();
  const dir = mkdtempSync(path.join(tmpdir(), "vox-inputs-"));
  const layout = path.join(dir, "in.yaml");
  writeFileSync(layout, `name: inputs-test
fixtures:
  heart: { type: mobius-heart, params: { panelsPerSide: 4, pitchMM: 10, twist: mobius } }
instances:
  - { fixture: heart, name: a }
  - { fixture: heart, name: b, pos: [1000, 0, 0] }
inputs:
  - { name: console, protocol: artnet, port: ${artPort}, priority: 100, timeoutMs: 300, map: { perUniverse: 170 } }
  - { name: web, protocol: ws, priority: 10, timeoutMs: 300 }
merge: { mode: priority, fallback: show }
`);
  const server = spawn("node", ["examples/mobius-heart/run.mjs", layout], { cwd: ROOT, env: { ...process.env, PORT: String(httpPort), VOX_NO_QR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  let scene = null;
  for (let i = 0; i < 80 && !scene; i++) { try { scene = await (await fetch(`http://localhost:${httpPort}/scene.json`)).json(); } catch { await sleep(100); } }
  ok(scene && scene.meta.inputs?.length === 2 && scene.meta.merge?.mode === "priority", "hub started with two inputs in scene.meta");
  const n = scene.count;
  const viewer = await wsConnect(httpPort);
  await sleep(200);
  const lastFrame = () => { const b = viewer.msgs.filter((m) => m.op === 0x2).at(-1); return b?.payload; };
  let f = lastFrame();
  ok(f && f.length === n * 3 && f.some((v) => v > 0), "bus frames flow (internal show) with no input live");
  // a page pushes a whole raw frame over the bus: all pixels 20
  const page = await wsConnect(httpPort);
  const raw = Buffer.alloc(n * 3, 20);
  page.send(raw); await sleep(120); page.send(raw); await sleep(120);
  f = lastFrame();
  ok(f && f[0] === 20 && f[(n - 1) * 3] === 20, "ws input: a raw RGB frame from a page drives every pixel");
  // Art-Net at higher priority covers universe 0 (pixels 0-169): those win, the rest stay the page's
  const tx = dgram.createSocket("udp4");
  const dmx = new Uint8Array(510).fill(200);
  for (let i = 0; i < 4; i++) { tx.send(artDmxPacket(0, i, dmx), artPort, "127.0.0.1"); page.send(raw); await sleep(60); }
  f = lastFrame();
  ok(f && f[0] === 200 && f[169 * 3] === 200 && f[170 * 3] === 20, "priority merge: Art-Net (prio 100) owns universe 0's pixels, the page (prio 10) keeps the rest");
  const st = await (await fetch(`http://localhost:${httpPort}/inputs`)).json();
  ok(st.inputs.length === 2 && st.inputs[0].name === "console" && st.inputs[0].live && st.inputs[1].live && st.inputs[0].universes >= 1, `/inputs reports both live (${st.inputs.map((i) => `${i.name}:${i.rate}/s`).join(" ")})`);
  // Art-Net stops → after its timeout the page's pixels come back; page stops → the show returns
  await sleep(400);
  page.send(raw); await sleep(120);
  f = lastFrame();
  ok(f && f[0] === 20, "Art-Net silent past timeoutMs → its pixels fall back to the next source");
  await sleep(450);
  f = lastFrame();
  ok(f && f.some((v, i) => v !== 20), "every input silent → the internal show is back (failover to show)");
  // Art-Net packets can also arrive over the bus (a relay page) — same map
  page.send(artDmxPacket(0, 9, new Uint8Array(510).fill(77)));
  await sleep(120);
  f = lastFrame();
  ok(f && f[0] === 77 && f[169 * 3] === 77, "ws input: Art-Net packets over the WebSocket go through the input map");
  // control over the bus + relay of other JSON to the other clients (pedestal buttons)
  page.send(Buffer.from(JSON.stringify({ type: "button", podpi: "a", button: "x", pressed: true })), 0x1);
  await sleep(100);
  const relayed = viewer.msgs.filter((m) => m.op === 0x1).map((m) => { try { return JSON.parse(m.payload.toString()); } catch { return null; } }).find((m) => m?.type === "button");
  ok(relayed && relayed.relay === true && relayed.button === "x", "a JSON message from one client is relayed to the others (the bus is the room)");
  page.send(Buffer.from(JSON.stringify({ type: "control", mode: "manual", fader: 0.5 })), 0x1);
  await sleep(100);
  const ctl = await (await fetch(`http://localhost:${httpPort}/control`)).json();
  ok(ctl.mode === "manual" && Math.abs(ctl.fader - 0.5) < 1e-6, "control JSON over the bus drives the crossfader like /control");
  ok(/inputs:\s+console \(artnet/.test(log) && /merge: priority/.test(log), "startup banner lists the inputs and the merge");
  tx.close(); viewer.sock.destroy(); page.sock.destroy();
  try { server.kill("SIGTERM"); } catch {}
}

console.log(`\n${fail === 0 ? "✅" : "❌"} inputs: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
