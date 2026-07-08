// Patch dispatcher: one scene, three protocols. Verify the layout carries the patch, and that
// the dispatcher routes each fixture to the right protocol/host with the right byte order.
import dgram from "node:dgram";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../src/yaml.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { sampleHeart } from "../examples/mobius-heart/heart.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { createDispatcher } from "../src/output/dispatch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const safety = setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 8000);

// ── patch is carried from YAML into the scene meta ───────────────────────────
const doc = parseYAML(readFileSync(`${ROOT}/examples/mobius-heart/layouts/patched.yaml`, "utf8"));
const { scene: patchedScene } = resolveLayout(doc, { fixtures: { "mobius-heart": (p) => sampleHeart(p) }, patterns: PATTERNS });
const protos = patchedScene.meta.instances.map((i) => i.output?.protocol);
ok(JSON.stringify(protos) === JSON.stringify(["artnet", "danmx", "ddp"]), `patched.yaml carries mixed protocols: ${protos}`);
ok(patchedScene.meta.instances[0].output.byteOrder === "grb", "per-fixture byteOrder carried (grb)");

// ── dispatcher routes + orders correctly (in-memory scene, test ports) ───────
const scene = {
  voxeled: "0.0.1", units: "mm", count: 6,
  meta: { instances: [
    { name: "a", output: { protocol: "artnet", host: "127.0.0.1", port: 16000, universe: 0, channel: 1, byteOrder: "grb" } },
    { name: "b", output: { protocol: "danmx", host: "127.0.0.1", port: 16001 } },
    { name: "c", output: { protocol: "ddp", host: "127.0.0.1", port: 16002, offset: 0 } },
  ] },
  pixels: [0, 0, 1, 1, 2, 2].map((inst, i) => ({ i, inst, p: [0, 0, 0], n: [0, 0, 1] })),
};
const rgb = new Uint8Array(6 * 3);
rgb.set([11, 22, 33], 0 * 3); // pixel 0 → instance a (artnet, grb)
rgb.set([44, 55, 66], 2 * 3); // pixel 2 → instance b (danmx, rgb)
rgb.set([77, 88, 99], 4 * 3); // pixel 4 → instance c (ddp, rgb)

const results = await new Promise((resolve) => {
  const got = {};
  const done = () => { if (got.art && got.dan && got.ddp) resolve(got); };
  for (const [name, port] of [["art", 16000], ["dan", 16001], ["ddp", 16002]]) {
    const s = dgram.createSocket("udp4");
    s.on("message", (msg) => { got[name] = msg; s.close(); done(); });
    s.bind(port, "127.0.0.1");
  }
  const disp = createDispatcher(scene);
  setTimeout(() => disp.send(rgb), 60); // let listeners bind
});

console.log("routing + byte order:");
const art = results.art;
ok(art.slice(0, 8).toString("latin1") === "Art-Net\0", "instance a → Art-Net");
ok(art[14] === 0 && art[15] === 0, "…universe 0");
ok(art[18] === 22 && art[19] === 11 && art[20] === 33, "…GRB reorder of (11,22,33) → (22,11,33)");

const dan = results.dan;
ok(dan.slice(0, 4).toString("latin1") === "DMX2", "instance b → dan-mx (magic DMX2)");
ok(dan[4] === 1 && dan[6] === 0 && dan[7] === 0, "…version 1, RAW, RGB888");
ok(dan.readUInt16BE(12) === 2, "…pixel_count 2");
ok(dan[14] === 44 && dan[15] === 55 && dan[16] === 66, "…RGB body (44,55,66)");

const dp = results.ddp;
ok((dp[0] & 0x40) !== 0 && (dp[0] & 0x01) !== 0, "instance c → DDP (version1 + push)");
ok(dp.readUInt32BE(4) === 0, "…offset 0");
ok(dp[10] === 77 && dp[11] === 88 && dp[12] === 99, "…RGB body (77,88,99)");

clearTimeout(safety);
console.log(`dispatch: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
