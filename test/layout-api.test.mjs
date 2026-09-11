// The live layout: GET /layout exposes the doc + expanded instances; POST applies an edit without a
// restart (scene.json changes, viewers get a text message); ?write=1 saves valid YAML; a bad doc is
// rejected and the running scene kept; editing the file externally reloads it.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../src/yaml.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

// a scratch copy of two-hearts.yaml (so saves don't touch the repo)
const dir = mkdtempSync(path.join(tmpdir(), "vox-layout-"));
const yamlPath = path.join(dir, "rig.yaml");
copyFileSync(path.join(ROOT, "examples/mobius-heart/layouts/two-hearts.yaml"), yamlPath);
const port = await freePort();
const server = spawn("node", ["examples/mobius-heart/run.mjs", yamlPath], { cwd: ROOT, env: { ...process.env, PORT: String(port), VOX_NO_QR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const done = (code) => { try { server.kill("SIGTERM"); } catch {} process.exit(code); };
const base = `http://localhost:${port}`;
let up = false;
for (let i = 0; i < 80; i++) { try { await fetch(`${base}/scene.json`); up = true; break; } catch { await sleep(100); } }
ok(up, "demo server started on a scratch layout");
if (!up) { console.log(log); done(1); }

// a raw WebSocket client to catch the "scene" text message
const wsText = [];
const ws = await new Promise((res) => {
  const s = net.connect(port, "127.0.0.1", () => s.write(`GET /bus HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  let hs = false;
  s.on("data", (d) => {
    if (!hs) { hs = true; const i = d.indexOf("\r\n\r\n"); d = d.subarray(i + 4); }
    // scan frames: opcode 1 = text
    let off = 0;
    while (off + 2 <= d.length) {
      const op = d[off] & 0x0f; let len = d[off + 1] & 0x7f; let h = 2;
      if (len === 126) { len = d.readUInt16BE(off + 2); h = 4; } else if (len === 127) { len = Number(d.readBigUInt64BE(off + 2)); h = 10; }
      if (off + h + len > d.length) break;
      if (op === 1) wsText.push(d.subarray(off + h, off + h + len).toString());
      off += h + len;
    }
  });
  setTimeout(() => res(s), 200);
});

// ── GET ──────────────────────────────────────────────────────────────────────
const g = await (await fetch(`${base}/layout`)).json();
ok(g.doc?.instances?.length === 2 && g.instances.length === 2, "GET /layout returns the doc and the expanded instances");
ok(g.fixtures.includes("mobius-heart") && g.fixtures.includes("mesh") && g.patterns.includes("spotlight"), "…and the available fixture types + patterns");
ok(g.instances[1].src?.i === 1, "expanded instances carry src → layout entry");

// ── POST: move an instance live (no write) ─────────────────────────────────────
const doc = g.doc;
doc.instances[1].pos = [3000, 0, 0];
let r = await (await fetch(`${base}/layout`, { method: "POST", body: JSON.stringify(doc) })).json();
ok(r.ok && r.instances === 2 && !r.written, "POST /layout applies live and reports not written");
let scene = await (await fetch(`${base}/scene.json`)).json();
ok(scene.meta.instances[1].pos[0] === 3000, "scene.json reflects the moved instance");
await sleep(100);
ok(wsText.some((t) => /"type":"scene"/.test(t)), "viewers get a { type: scene } text message on the bus");
ok(readFileSync(yamlPath, "utf8").includes("1524"), "…and the file was NOT written");

// ── POST with an array generator, write=1 → valid YAML on disk ────────────────
doc.instances = [{ fixture: "heart", name: "row", array: { count: [3, 1, 1], spacing: [2000, 0, 0], center: true } }];
r = await (await fetch(`${base}/layout?write=1`, { method: "POST", body: JSON.stringify(doc) })).json();
ok(r.ok && r.written && r.instances === 3, "POST ?write=1 applies (3 instances from the array) and writes");
const saved = parseYAML(readFileSync(yamlPath, "utf8"));
ok(saved.instances[0].array.count[0] === 3 && saved.fixtures.heart.structures.length === 2, "the saved YAML round-trips the array + keeps structures");
ok(readFileSync(yamlPath, "utf8").startsWith("# voxeled layout"), "the file's comment header is preserved");
scene = await (await fetch(`${base}/scene.json`)).json();
ok(scene.meta.instances.map((i) => i.name).join() === "row-0-0,row-1-0,row-2-0" && scene.meta.instances[0].pos[0] === -2000, "expanded array instances are named and centred");

// ── emitter + patch edits (what the builder panel writes) ─────────────────────
doc.instances[0].emitter = { viewingAngleDeg: 30, softness: 0.9 };            // on the array entry → all 3 elements
doc.instances[0].output = { protocol: "ddp", host: "10.0.0.9", offset: 0 };
doc.instances.push({ fixture: "heart", name: "solo", pos: [0, 0, 4000] });       // a plain instance: inherits the fixture default
doc.fixtures.heart.output = { protocol: "artnet", host: "10.0.0.5", universe: 4 }; // fixture default
r = await (await fetch(`${base}/layout?write=1`, { method: "POST", body: JSON.stringify(doc) })).json();
scene = await (await fetch(`${base}/scene.json`)).json();
ok(r.ok && scene.meta.instances[0].emitter.viewingAngleDeg === 30 && scene.meta.instances[0].emitter.sizeFrac === 1.0, "instance emitter override merges over the fixture default");
ok(scene.meta.instances[2].output.protocol === "ddp" && scene.meta.instances[3].output.protocol === "artnet" && scene.meta.instances[3].output.universe === 4, "entry-level output overrides the fixture-level patch; a plain instance inherits the default");
const savedPatch = parseYAML(readFileSync(yamlPath, "utf8"));
ok(savedPatch.instances[0].output.host === "10.0.0.9" && savedPatch.fixtures.heart.output.universe === 4, "…and both land in the saved YAML");

// ── "new fixture from a file" (the builder's create-and-add): a baked .vxl next to the layout ──
writeFileSync(path.join(dir, "piece.vxl.json"), JSON.stringify({ pixels: [0, 1, 2].map((i) => ({ i, p: [i * 100, 0, 0], n: [0, 0, 1], s: i / 2, v: 0 })), meta: { pitchMM: 100 } }));
doc.fixtures.piece = { type: "vxl", params: { file: "piece.vxl.json" } }; // relative to the layout file
doc.instances.push({ fixture: "piece", name: "piece-1", pos: [0, 0, 9000] });
r = await (await fetch(`${base}/layout`, { method: "POST", body: JSON.stringify(doc) })).json();
scene = await (await fetch(`${base}/scene.json`)).json();
const pieceInst = scene.meta.instances.find((i) => i.name === "piece-1");
ok(r.ok && pieceInst && scene.pixels.filter((p) => p.inst === scene.meta.instances.indexOf(pieceInst)).length === 3, "a fixture defined from a file path relative to the layout resolves and places");

// ── a bad doc is rejected and nothing changes ─────────────────────────────────
const bad = await fetch(`${base}/layout`, { method: "POST", body: JSON.stringify({ ...doc, instances: [{ fixture: "nope" }] }) });
ok(bad.status === 400 && /unknown fixture|undefined fixture/.test((await bad.json()).error), "a layout referencing a missing fixture → 400 with the error");
scene = await (await fetch(`${base}/scene.json`)).json();
ok(scene.meta.instances.length === 5, "…and the running scene is untouched");

// ── external edit → watched file reloads ───────────────────────────────────────
const text = readFileSync(yamlPath, "utf8").replace("count: [3, 1, 1]", "count: [4, 1, 1]");
await sleep(50);
writeFileSync(yamlPath, text);
let reloaded = false;
// (the "piece" fixture was applied live but never saved, so the file on disk has the array + solo)
for (let i = 0; i < 30; i++) { await sleep(100); scene = await (await fetch(`${base}/scene.json`)).json(); if (scene.meta.instances.some((x) => x.name === "row-3-0")) { reloaded = true; break; } }
ok(reloaded && scene.meta.instances.length === 5 && !scene.meta.instances.some((x) => x.name === "piece-1"), "editing the file on disk reloads the scene from the FILE (4-wide array + solo = 5; the unsaved piece is gone)");
ok(/reloaded/.test(log), "…and the hub logs the reload");

ws.destroy();
console.log(`\n${fail === 0 ? "✅" : "❌"} layout-api: ${pass} passed, ${fail} failed`);
done(fail === 0 ? 0 : 1);
