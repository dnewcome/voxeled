// Inspect a glTF/GLB as a voxeled fixture (points + normals). Doesn't run anything — just reports.
//   node examples/mobius-heart/import.mjs path/to.glb
import path from "node:path";
import { readFileSync } from "node:fs";
import { gltfToFixture } from "../../src/io/gltf-import.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: node import.mjs <file.glb>"); process.exit(1); }

const fixture = gltfToFixture(readFileSync(path.resolve(file)));
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const px of fixture.pixels) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], px.p[k]); hi[k] = Math.max(hi[k], px.p[k]); }

console.log(`✓ ${path.basename(file)} → fixture "${fixture.meta.name}"`);
console.log(`  points:  ${fixture.meta.points.toLocaleString()}`);
console.log(`  bounds:  ${[0, 1, 2].map((k) => (hi[k] - lo[k]).toFixed(0)).join(" × ")} mm  (W×H×D)`);
console.log(`  pitch:   ~${fixture.meta.pitchMM} mm (estimated)`);
console.log(`  normals: ${fixture.meta.hadNormals ? "from file" : "estimated (outward from centroid)"}`);
console.log(`  sample:  p=[${fixture.pixels[0].p}]  n=[${fixture.pixels[0].n}]`);
