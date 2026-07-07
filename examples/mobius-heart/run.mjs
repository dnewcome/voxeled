// run.mjs — the full demo. Map N hearts into a rig, run a crossfading SHOW on the hub, and fan
// identical frames to the browser viewer (WebSocket) and optionally to real fixtures over
// Art-Net / DDP. Demonstrates: multi-instance layout, world-vs-fixture pattern space (the
// "account for distance" toggle), and scene crossfades.
//
//   node examples/mobius-heart/run.mjs
//   VOX_HEARTS=2 VOX_SPACING_FT=10 node examples/mobius-heart/run.mjs
//   VOX_PATTERN=worldWipe node examples/mobius-heart/run.mjs   # single pattern, no crossfade
//   ARTNET=192.168.1.50 DDP=192.168.1.60 node examples/mobius-heart/run.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateScene } from "./map.mjs";
import { createBus } from "../../src/bus.mjs";
import { createHub } from "../../src/hub.mjs";
import { createShow } from "../../src/mixer.mjs";
import { PATTERNS } from "../../src/patterns.mjs";
import { createArtNetSender } from "../../src/senders/artnet.mjs";
import { createDDPSender } from "../../src/senders/ddp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);

const scene = generateScene({
  hearts: +(process.env.VOX_HEARTS || 2),
  spacingFt: +(process.env.VOX_SPACING_FT || 10),
  panelsPerSide: +(process.env.VOX_PANELS || 8),
  pitchMM: +(process.env.VOX_PITCH || 10),
  twist: process.env.VOX_TWIST || "mobius",
});

// The show: three scenes the mixer crossfades between. Scenes 1 & 2 are the same wipe in the two
// coordinate spaces, so dissolving between them literally shows the 10-ft gap being accounted for.
const scenes = [
  { name: "chase (per-heart)", render: PATTERNS.ribbonChase() },
  { name: "wipe · across (world)", render: PATTERNS.worldWipe({ axis: 0, space: "world" }) },
  { name: "wipe · synced (fixture)", render: PATTERNS.worldWipe({ axis: 0, space: "fixture" }) },
];
const control = { mode: "auto", fader: 0, a: 0, b: 1 };
const show = createShow({ scenes, holdS: 4, fadeS: 2.5, control });

// A single-pattern override for debugging (no crossfade).
const single = process.env.VOX_PATTERN && PATTERNS[process.env.VOX_PATTERN];
if (process.env.VOX_PATTERN && !single) {
  console.error(`unknown pattern "${process.env.VOX_PATTERN}". options: ${Object.keys(PATTERNS).join(", ")}`);
  process.exit(1);
}
const shade = single ? single() : show.shade;

// Attach show metadata for the viewer (scene names, timing).
scene.meta.show = { scenes: show.names, holdS: 4, fadeS: 2.5, single: !!single };
const sceneJSON = JSON.stringify(scene);

const senders = [];
if (process.env.ARTNET) senders.push(createArtNetSender({ host: process.env.ARTNET }));
if (process.env.DDP) senders.push(createDDPSender({ host: process.env.DDP }));

// Control endpoint: the viewer's crossfader / auto toggle pokes this to drive `control`.
function controlHandler(req, res, params) {
  if (params.has("mode")) control.mode = params.get("mode") === "manual" ? "manual" : "auto";
  if (params.has("fader")) control.fader = Math.max(0, Math.min(1, +params.get("fader")));
  if (params.has("a")) control.a = +params.get("a");
  if (params.has("b")) control.b = +params.get("b");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(control));
}

const bus = createBus({
  port: PORT,
  routes: [
    { path: "/", file: path.join(HERE, "../../viewer/index.html"), contentType: "text/html; charset=utf-8" },
    { path: "/scene.json", content: sceneJSON, contentType: "application/json" },
    { path: "/control", handler: controlHandler },
  ],
});

const hub = createHub({ scene, shade, fps: 30, bus, senders });
hub.start();

console.log(`♥ voxeled — Möbius LED Heart demo`);
console.log(`  rig:     ${scene.meta.instances.length} heart(s), ${scene.meta.spacingFt} ft apart · ${scene.count.toLocaleString()} px`);
console.log(single ? `  pattern: ${process.env.VOX_PATTERN} (single)` : `  show:    ${show.names.join("  →  ")}  (auto-crossfade)`);
console.log(`  senders: ${senders.length ? senders.map((s) => `${s.kind}→${s.target}`).join(", ") : "none (set ARTNET=host and/or DDP=host)"}`);
console.log(`  viewer:  ${bus.url}`);

process.on("SIGINT", () => {
  hub.stop();
  bus.close();
  for (const s of senders) s.close();
  console.log("\nbye");
  process.exit(0);
});
