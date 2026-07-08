// run.mjs — the full demo. Load a YAML layout (a rig of fixture instances + a show), run it on
// the hub, and fan identical frames to the browser viewer (WebSocket) and optionally to real
// fixtures over Art-Net / DDP. The rig, fixture params, and scenes all live in the layout file.
//
//   node examples/mobius-heart/run.mjs                                    # default two-hearts.yaml
//   VOX_LAYOUT=examples/mobius-heart/layouts/facing-hearts.yaml npm run demo
//   VOX_PATTERN=worldWipe node examples/mobius-heart/run.mjs              # one pattern, no crossfade
//   ARTNET=192.168.1.50 DDP=192.168.1.60 node examples/mobius-heart/run.mjs
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../../src/yaml.mjs";
import { resolveLayout } from "../../src/layout.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { createBus } from "../../src/bus.mjs";
import { createHub } from "../../src/hub.mjs";
import { createShow } from "../../src/mixer.mjs";
import { PATTERNS } from "../../src/patterns.mjs";
import { createArtNetSender } from "../../src/senders/artnet.mjs";
import { createDDPSender } from "../../src/senders/ddp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);

// Load + resolve the layout file into a scene (the rig) and a show (the scenes).
// Layout: first CLI arg (e.g. `node run.mjs path/to.yaml`), else VOX_LAYOUT, else two-hearts.
const layoutPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.VOX_LAYOUT
    ? path.resolve(process.env.VOX_LAYOUT)
    : path.join(HERE, "layouts/two-hearts.yaml");
let scene, showCfg;
try {
  const doc = parseYAML(readFileSync(layoutPath, "utf8"));
  ({ scene, show: showCfg } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS }));
} catch (e) {
  console.error(`layout error in ${path.relative(process.cwd(), layoutPath)}:\n  ${e.message}`);
  process.exit(1);
}

// Build the shade function: the show's crossfade, or a single pattern override for debugging.
const control = { mode: "auto", fader: 0, a: 0, b: 1 };
const single = process.env.VOX_PATTERN && PATTERNS[process.env.VOX_PATTERN];
if (process.env.VOX_PATTERN && !single) {
  console.error(`unknown pattern "${process.env.VOX_PATTERN}". options: ${Object.keys(PATTERNS).join(", ")}`);
  process.exit(1);
}
const scenes = showCfg?.scenes?.length ? showCfg.scenes : [{ name: "chase", render: PATTERNS.ribbonChase() }];
const show = createShow({ scenes, holdS: showCfg?.holdS ?? 4, fadeS: showCfg?.fadeS ?? 2.5, control });
const shade = single ? single() : show.shade;

scene.meta.show = { scenes: show.names, single: !!single };
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
  staticDir: path.join(HERE, "../../viewer"), // serves index.html + vendored three.js
  routes: [
    { path: "/scene.json", content: sceneJSON, contentType: "application/json" },
    { path: "/control", handler: controlHandler },
  ],
});

bus.server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n✗ port ${PORT} is already in use — another demo is likely running. Stop it, or run with PORT=<n>.`);
    process.exit(1);
  }
  throw e;
});

const hub = createHub({ scene, shade, fps: 30, bus, senders });
hub.start();

console.log(`♥ voxeled — Möbius LED Heart demo`);
console.log(`  layout:  ${path.relative(process.cwd(), layoutPath)} — "${scene.name}"`);
console.log(`  rig:     ${scene.meta.instances.length} instance(s) · ${scene.count.toLocaleString()} px`);
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
