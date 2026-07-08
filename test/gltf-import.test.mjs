// glTF import: round-trip a scene (export → GLB → import as fixture) and confirm the geometry
// survives — point count, positions (back in mm), and unit normals.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../src/yaml.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { sampleHeart } from "../examples/mobius-heart/heart.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { sceneToGLB } from "../src/io/gltf.mjs";
import { gltfToFixture, parseGLB } from "../src/io/gltf-import.mjs";
import { len } from "../src/vec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

const doc = parseYAML(readFileSync(`${ROOT}/examples/mobius-heart/layouts/two-hearts.yaml`, "utf8"));
const { scene } = resolveLayout(doc, { fixtures: { "mobius-heart": (p) => sampleHeart(p) }, patterns: PATTERNS });
const glb = sceneToGLB(scene, { colors: null });

// parseGLB round-trips the container.
const { gltf, bin } = parseGLB(glb);
ok(gltf.asset.version === "2.0" && bin.length > 0, "parseGLB reads JSON + BIN chunks");

const fixture = gltfToFixture(glb);
ok(fixture.pixels.length === scene.count, `imported point count matches (${fixture.pixels.length})`);
ok(fixture.meta.hadNormals === true, "normals were present and imported (not estimated)");

// Positions come back in mm (glTF metres × 1000), matching the original within float tolerance.
const worst = scene.pixels.reduce((mx, orig, i) => {
  const im = fixture.pixels[i].p;
  const d = Math.hypot(im[0] - orig.p[0], im[1] - orig.p[1], im[2] - orig.p[2]);
  return Math.max(mx, d);
}, 0);
ok(worst < 1.0, `positions round-trip in mm (worst error ${worst.toFixed(3)} mm)`);

// Normals are unit length.
let badN = 0;
for (const px of fixture.pixels) { const l = len(px.n); if (!(l > 0.99 && l < 1.01)) badN++; }
ok(badN === 0, "all imported normals are unit length");

// Pitch estimate is sane for a 10 mm-pitch source.
ok(fixture.meta.pitchMM > 4 && fixture.meta.pitchMM < 25, `pitch estimated near source (${fixture.meta.pitchMM} mm)`);

// A hand-built GLB with POSITION only (no NORMAL) — exercises the fallback AND proves the reader
// isn't coupled to voxeled's own writer.
function positionOnlyGLB(points) {
  const f32 = new Float32Array(points.flat());
  const bin = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const gltf = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ mode: 0, attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: points.length, type: "VEC3", min: lo, max: hi }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }], buffers: [{ byteLength: bin.length }] };
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, json, bh, bin]);
}
const noNorm = gltfToFixture(positionOnlyGLB([[1, 0, 0], [-1, 0, 0], [0, 1, 0]]), { scaleToMM: 1 });
ok(noNorm.pixels.length === 3 && noNorm.meta.hadNormals === false, "reads a foreign POSITION-only GLB (no NORMAL)");
ok(noNorm.pixels.every((px) => Math.abs(len(px.n) - 1) < 0.01), "missing normals filled (unit, outward from centroid)");

console.log(`gltf-import: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
