// map.mjs — the "map" half of the demo. Evaluate the heart parametrization at each pixel and
// emit a voxeled scene (position + normal + ribbon coords). This is voxeled's importer for a
// procedurally-generated piece: no camera, no CAD-normal guessing — the normals are exact.
//
//   node examples/mobius-heart/map.mjs [--panels 8] [--pitch 10] [--twist mobius]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sampleHeart } from "./heart.mjs";
import { buildScene, saveScene, bounds } from "../../src/format.mjs";
import { len } from "../../src/vec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCENE_PATH = path.join(HERE, "mobius-heart.vxl.json");

export function generateScene(opts = {}) {
  const { pixels, meta } = sampleHeart(opts);
  return buildScene({ name: "mobius-led-heart", units: "mm", pixels, meta });
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    if (k) o[k] = argv[i + 1];
  }
  const opts = {};
  if (o.panels) opts.panelsPerSide = +o.panels;
  if (o.pitch) opts.pitchMM = +o.pitch;
  if (o.twist) opts.twist = o.twist;
  if (o.band) opts.bandMM = +o.band;
  return opts;
}

// Run as CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const scene = generateScene(parseArgs(process.argv.slice(2)));
  saveScene(SCENE_PATH, scene);

  const b = bounds(scene);
  // Sanity: every emission normal must be unit length (proves the map didn't degenerate).
  let minL = Infinity, maxL = -Infinity, bad = 0;
  for (const px of scene.pixels) {
    const l = len(px.n);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (!(l > 0.99 && l < 1.01)) bad++;
  }

  console.log(`✓ wrote ${path.relative(process.cwd(), SCENE_PATH)}`);
  console.log(`  pixels:   ${scene.count.toLocaleString()}  (${scene.meta.cols} around × ${scene.meta.rows} across)`);
  console.log(`  twist:    ${scene.meta.twist}`);
  console.log(`  perimeter ${scene.meta.perimMM} mm   height ${scene.meta.heightMM} mm`);
  console.log(`  bounds:   ${b.size.map((x) => x.toFixed(0)).join(" × ")} mm  (W×H×D)`);
  console.log(`  normals:  |n| ∈ [${minL.toFixed(4)}, ${maxL.toFixed(4)}]   non-unit: ${bad}`);
  console.log(`  sample:   p=[${scene.pixels[0].p}]  n=[${scene.pixels[0].n}]  s=${scene.pixels[0].s}`);
}
