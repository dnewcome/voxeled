// DDP receiver — voxeled as a DDP Display, against the 3waylabs spec: multi-packet frames with
// PUSH, non-PUSH senders, data types, Query/Reply for status/config/framebuffer + the empty reply
// for unsupported IDs, duplicate suppression, version check — and the end-to-end bridge: DDP in →
// the patch dispatcher → Art-Net out.
import dgram from "node:dgram";
import { createDDPInput, ddpHeader, ID_DISPLAY, ID_STATUS, ID_CONFIG, ID_ALL } from "../src/input/ddp.mjs";
import { ddpPacket, createDDPSender } from "../src/senders/ddp.mjs";
import { createDispatcher } from "../src/output/dispatch.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const safety = setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 10000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F_PUSH = 0x01, F_QUERY = 0x02, F_REPLY = 0x04;

// a Display with 600 pixels (1800 bytes → two DDP packets at 1440)
const frames = [];
const input = createDDPInput({ port: 0, host: "127.0.0.1", pixelCount: 600, name: "test-piece", onFrame: (rgb) => frames.push(Buffer.from(rgb)) });
await new Promise((r) => input.sock.once("listening", r));
const port = input.sock.address().port;
const client = dgram.createSocket("udp4");
const replies = [];
client.on("message", (m) => replies.push(m));
const sendRaw = (buf) => new Promise((r) => client.send(buf, port, "127.0.0.1", r));

// ── multi-packet frame: offset 0 (no push) + offset 1440 (push) → ONE frame, bytes intact ──
const frame = Buffer.alloc(1800); for (let i = 0; i < 1800; i++) frame[i] = (i * 7) & 0xff;
await sendRaw(ddpPacket(0, frame.subarray(0, 1440), false, 1));
await sendRaw(ddpPacket(1440, frame.subarray(1440), true, 2));
await sleep(40);
ok(frames.length === 1, "two packets + PUSH → exactly one displayed frame");
ok(frames[0]?.equals(frame), "the framebuffer is reassembled from offsets, bytes intact");
ok(input.stats.packets === 2 && input.stats.frames === 1, "stats count packets and frames");

// ── a bare broadcast PUSH (no data) displays the buffer again ──
await sendRaw(ddpPacket(0, Buffer.alloc(3, 9), false, 3));
await sendRaw(ddpHeader({ flags: F_PUSH, seq: 4, id: ID_ALL, offset: 0, len: 0 }));
await sleep(30);
ok(frames.length === 2 && frames[1][0] === 9 && frames[1][3] === frame[3], "a data-less PUSH to ID 255 displays the current buffer (partial update kept the rest)");

// ── duplicate suppression: identical packet (same seq/offset) back-to-back is dropped ──
const before = input.stats.frames;
await sendRaw(ddpPacket(0, Buffer.alloc(3, 1), true, 5));
await sendRaw(ddpPacket(0, Buffer.alloc(3, 1), true, 5));
await sleep(30);
ok(input.stats.frames === before + 1 && input.stats.duplicates === 1, "a repeated packet (same sequence number) is ignored");

// ── non-PUSH sender: the next frame starting at offset 0 displays the previous one ──
const noPushBefore = input.stats.frames;
await sendRaw(ddpPacket(0, Buffer.alloc(1800, 33), false, 6));
await sleep(20);
ok(input.stats.frames === noPushBefore, "…a frame without PUSH is held");
await sendRaw(ddpPacket(0, Buffer.alloc(1800, 44), false, 7));
await sleep(30);
ok(input.stats.frames === noPushBefore + 1 && frames.at(-1)[0] === 33, "…and displayed when the sender starts the next frame at offset 0");

// ── data types: RGBW folds white in; grayscale replicates ──
const rgbw = Buffer.from([10, 20, 30, 5, 0, 0, 0, 255]);
await sendRaw(Buffer.concat([ddpHeader({ flags: F_PUSH, seq: 8, type: (3 << 3) | 3, id: ID_DISPLAY, offset: 0, len: rgbw.length }), rgbw]));
await sleep(30);
let f = frames.at(-1);
ok(f[0] === 15 && f[1] === 25 && f[2] === 35 && f[3] === 255 && f[5] === 255, "RGBW (type 011, 8-bit) → RGB with white folded in");
await sendRaw(Buffer.concat([ddpHeader({ flags: F_PUSH, seq: 9, type: (4 << 3) | 3, id: ID_DISPLAY, offset: 0, len: 2 }), Buffer.from([7, 200])]));
await sleep(30);
f = frames.at(-1);
ok(f[0] === 7 && f[1] === 7 && f[2] === 7 && f[3] === 200 && f[5] === 200, "grayscale (type 100) → replicated RGB");

// ── queries: status (discovery), config, framebuffer read-back, unsupported ID ──
const parse = (m) => ({ flags: m[0], id: m[3], offset: m.readUInt32BE(4), len: m.readUInt16BE(8), data: m.subarray(10, 10 + m.readUInt16BE(8)) });
replies.length = 0;
await sendRaw(ddpHeader({ flags: F_QUERY, seq: 10, id: ID_STATUS, offset: 0, len: 512 }));
await sleep(40);
let r = replies[0] && parse(replies[0]);
const status = r && JSON.parse(r.data.toString());
ok(r && (r.flags & F_REPLY) && (r.flags & F_PUSH) && r.id === ID_STATUS, "status Query → Reply with R+P flags on ID 251");
ok(status?.status?.man === "voxeled" && status.status.push === true && status.status.pixels === 600, `…JSON status announces voxeled (${status?.status?.name}, ${status?.status?.pixels} px)`);
replies.length = 0;
await sendRaw(ddpHeader({ flags: F_QUERY, seq: 11, id: ID_CONFIG, offset: 0, len: 512 }));
await sleep(40);
r = replies[0] && parse(replies[0]);
const cfg = r && JSON.parse(r.data.toString());
ok(cfg?.config?.ports?.[0]?.l === 600, "config Query → ports[0].l = pixel count (what an xLights-style controller wants)");
replies.length = 0;
await sendRaw(ddpPacket(0, Buffer.from([1, 2, 3, 4, 5, 6]), true, 12));
await sendRaw(ddpHeader({ flags: F_QUERY, seq: 13, id: ID_DISPLAY, offset: 3, len: 3 }));
await sleep(40);
r = replies[0] && parse(replies[0]);
ok(r && r.offset === 3 && r.len === 3 && r.data.equals(Buffer.from([4, 5, 6])), "framebuffer read-back: Query ID 1 at offset 3 returns those bytes");
replies.length = 0;
await sendRaw(ddpHeader({ flags: F_QUERY, seq: 14, id: 77, offset: 9, len: 9 }));
await sleep(40);
r = replies[0] && parse(replies[0]);
ok(r && r.offset === 0 && r.len === 0 && (r.flags & F_PUSH), "unsupported ID → empty Reply (offset 0, length 0, Push) per spec");

// ── version / reply packets are ignored ──
const pk = input.stats.packets;
await sendRaw(Buffer.concat([Buffer.from([0x80]), ddpPacket(0, Buffer.alloc(3), true, 1).subarray(1)])); // version 2
await sendRaw(ddpHeader({ flags: F_REPLY | F_PUSH, seq: 1, id: ID_DISPLAY, offset: 0, len: 0 }));
await sleep(30);
ok(input.stats.packets === pk, "non-v1 and Reply packets are ignored");

// ── the bridge: our own DDP sender → this receiver → dispatcher → Art-Net out ──
const artSock = dgram.createSocket("udp4");
const artPkts = [];
artSock.on("message", (m) => artPkts.push(m));
await new Promise((r) => artSock.bind(0, "127.0.0.1", r));
const scene = { pixels: [0, 1, 2].map((i) => ({ i, inst: 0, p: [0, 0, 0], n: [0, 0, 1] })), meta: { instances: [{ name: "a", output: { protocol: "artnet", host: "127.0.0.1", port: artSock.address().port, universe: 3, channel: 1 } }] } };
const disp = createDispatcher(scene);
const bridgeIn = createDDPInput({ port: 0, host: "127.0.0.1", pixelCount: 3, onFrame: (rgb) => disp.send(rgb) });
await new Promise((r) => bridgeIn.sock.once("listening", r));
const ddpOut = createDDPSender({ host: "127.0.0.1", port: bridgeIn.sock.address().port });
ddpOut.send(new Uint8Array([200, 100, 50, 1, 2, 3, 4, 5, 6]));
await sleep(60);
ok(artPkts.length === 1 && artPkts[0].subarray(0, 8).toString("latin1") === "Art-Net\0" && artPkts[0][14] === 3, "DDP in → dispatcher → Art-Net out (universe 3)");
ok(artPkts[0] && artPkts[0][18] === 200 && artPkts[0][19] === 100 && artPkts[0][20] === 50, "…pixel colours survive the protocol bridge");

client.close(); artSock.close(); ddpOut.close(); disp.close(); input.close(); bridgeIn.close();
clearTimeout(safety);
console.log(`\n${fail === 0 ? "✅" : "❌"} ddp-input: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
