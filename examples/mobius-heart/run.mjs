// run.mjs — the full Phase-0 demo, one process. Map the heart, run a spatial pattern on the
// hub, and fan frames to the browser viewer (WebSocket) and optionally to real fixtures over
// Art-Net / DDP. Preview and output are the same frames.
//
//   node examples/mobius-heart/run.mjs
//   VOX_PATTERN=ribbonChase node examples/mobius-heart/run.mjs
//   ARTNET=192.168.1.50 DDP=192.168.1.60 node examples/mobius-heart/run.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateScene } from "./map.mjs";
import { createBus } from "../../src/bus.mjs";
import { createHub } from "../../src/hub.mjs";
import { PATTERNS } from "../../src/patterns.mjs";
import { createArtNetSender } from "../../src/senders/artnet.mjs";
import { createDDPSender } from "../../src/senders/ddp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);

const scene = generateScene({
  panelsPerSide: +(process.env.VOX_PANELS || 8),
  pitchMM: +(process.env.VOX_PITCH || 10),
  twist: process.env.VOX_TWIST || "mobius",
});
const sceneJSON = JSON.stringify(scene);

const patternName = process.env.VOX_PATTERN || "planeSweep";
const patternFactory = PATTERNS[patternName];
if (!patternFactory) {
  console.error(`unknown pattern "${patternName}". options: ${Object.keys(PATTERNS).join(", ")}`);
  process.exit(1);
}
const pattern = patternFactory();

const senders = [];
if (process.env.ARTNET) senders.push(createArtNetSender({ host: process.env.ARTNET }));
if (process.env.DDP) senders.push(createDDPSender({ host: process.env.DDP }));

const bus = createBus({
  port: PORT,
  routes: [
    { path: "/", file: path.join(HERE, "../../viewer/index.html"), contentType: "text/html; charset=utf-8" },
    { path: "/scene.json", content: sceneJSON, contentType: "application/json" },
  ],
});

const hub = createHub({ scene, pattern, fps: 30, bus, senders });
hub.start();

console.log(`♥ voxeled — Möbius LED Heart demo`);
console.log(`  pixels:  ${scene.count.toLocaleString()}  (twist: ${scene.meta.twist})`);
console.log(`  pattern: ${patternName}   [set VOX_PATTERN=${Object.keys(PATTERNS).join("|")}]`);
console.log(`  senders: ${senders.length ? senders.map((s) => `${s.kind}→${s.target}`).join(", ") : "none (set ARTNET=host and/or DDP=host)"}`);
console.log(`  viewer:  ${bus.url}`);

process.on("SIGINT", () => {
  hub.stop();
  bus.close();
  for (const s of senders) s.close();
  console.log("\nbye");
  process.exit(0);
});
