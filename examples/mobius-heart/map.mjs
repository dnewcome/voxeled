// map.mjs — the "map" half of the demo. Sample the heart's parametric ribbon into a fixture
// (exact position + normal per pixel), then place one or more instances in shared world space.
// This is voxeled's importer for a procedural piece: no camera, the normals are exact.
//
//   node examples/mobius-heart/map.mjs [--hearts 2] [--spacing 10] [--panels 8] [--pitch 10] [--twist mobius]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sampleHeart } from "./heart.mjs";
import { buildSceneFromLayout } from "../../src/layout.mjs";
import { bounds } from "../../src/format.mjs";
import { len } from "../../src/vec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCENE_PATH = path.join(HERE, "mobius-heart.vxl.json");
const FT_MM = 304.8;

// hearts placed in a row along X, spacingFt apart, centred on the origin.
export function generateScene({ hearts = 1, spacingFt = 10, ...heartOpts } = {}) {
  const fixture = sampleHeart(heartOpts);
  const spacingMM = spacingFt * FT_MM;
  const instances = [];
  for (let k = 0; k < hearts; k++) {
    const x = (k - (hearts - 1) / 2) * spacingMM;
    instances.push({ name: `heart-${k + 1}`, pos: [+x.toFixed(1), 0, 0], rotDeg: [0, 0, 0] });
  }
  return buildSceneFromLayout({
    name: "mobius-led-heart",
    fixture,
    instances,
    meta: { spacingFt, spacingMM, perFixture: fixture.pixels.length },
  });
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    if (k) o[k] = argv[i + 1];
  }
  const opts = {};
  if (o.hearts) opts.hearts = +o.hearts;
  if (o.spacing) opts.spacingFt = +o.spacing;
  if (o.panels) opts.panelsPerSide = +o.panels;
  if (o.pitch) opts.pitchMM = +o.pitch;
  if (o.twist) opts.twist = o.twist;
  if (o.band) opts.bandMM = +o.band;
  return opts;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { saveScene } = await import("../../src/format.mjs");
  const scene = generateScene(parseArgs(process.argv.slice(2)));
  saveScene(SCENE_PATH, scene);

  const b = bounds(scene);
  let minL = Infinity, maxL = -Infinity, bad = 0;
  for (const px of scene.pixels) {
    const l = len(px.n);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (!(l > 0.99 && l < 1.01)) bad++;
  }

  console.log(`✓ wrote ${path.relative(process.cwd(), SCENE_PATH)}`);
  console.log(`  instances: ${scene.meta.instances.length}  (${scene.meta.perFixture.toLocaleString()} px each, ${scene.meta.spacingFt} ft apart)`);
  console.log(`  pixels:    ${scene.count.toLocaleString()} total`);
  console.log(`  bounds:    ${b.size.map((x) => x.toFixed(0)).join(" × ")} mm  (W×H×D)`);
  console.log(`  normals:   |n| ∈ [${minL.toFixed(4)}, ${maxL.toFixed(4)}]   non-unit: ${bad}`);
}
