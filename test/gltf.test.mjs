// glTF export: build a .glb in memory and parse it back, validating it's spec-compliant glTF 2.0
// that a standard loader will open (magic, chunks, accessors, point counts, metre scale, extras).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../src/yaml.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { sampleHeart } from "../examples/mobius-heart/heart.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { sceneToGLB } from "../src/io/gltf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

const doc = parseYAML(readFileSync(`${ROOT}/examples/mobius-heart/layouts/two-hearts.yaml`, "utf8"));
const { scene } = resolveLayout(doc, { fixtures: { "mobius-heart": (p) => sampleHeart(p) }, patterns: PATTERNS });
const glb = sceneToGLB(scene, { colors: null });

// ── GLB container ────────────────────────────────────────────────────────────
ok(glb.readUInt32LE(0) === 0x46546c67, "GLB magic 'glTF'");
ok(glb.readUInt32LE(4) === 2, "glTF version 2");
ok(glb.readUInt32LE(8) === glb.length, "header total length matches buffer");

const jsonLen = glb.readUInt32LE(12);
ok(glb.readUInt32LE(16) === 0x4e4f534a, "chunk 0 is JSON");
const gltf = JSON.parse(glb.slice(20, 20 + jsonLen).toString("utf8"));
const binHdr = 20 + jsonLen;
ok(glb.readUInt32LE(binHdr + 4) === 0x004e4942, "chunk 1 is BIN");
const binLen = glb.readUInt32LE(binHdr);
const bin = glb.slice(binHdr + 8, binHdr + 8 + binLen);
ok(gltf.buffers[0].byteLength <= binLen, "buffer byteLength fits the BIN chunk");

// ── Structure ────────────────────────────────────────────────────────────────
ok(gltf.asset.version === "2.0", "asset.version 2.0");
ok(gltf.nodes.length === scene.meta.instances.length, `one node per instance (${gltf.nodes.length})`);
ok(gltf.nodes[0].name === scene.meta.instances[0].name, `node named from instance ("${gltf.nodes[0].name}")`);

let totalPoints = 0, sawNormal = false, sawColor = false, allPoints = true;
for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    if (prim.mode !== 0) allPoints = false;
    const a = prim.attributes;
    totalPoints += gltf.accessors[a.POSITION].count;
    if (a.NORMAL != null) sawNormal = true;
    if (a.COLOR_0 != null) sawColor = true;
  }
}
ok(allPoints, "all primitives are POINTS (mode 0)");
ok(totalPoints === scene.count, `points sum to scene.count (${totalPoints})`);
ok(sawNormal && sawColor, "primitives carry NORMAL + COLOR_0");

const posAcc = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
ok(posAcc.type === "VEC3" && posAcc.componentType === 5126, "POSITION is VEC3 float");
ok(Array.isArray(posAcc.min) && posAcc.min.length === 3 && Array.isArray(posAcc.max), "POSITION has min/max (required by spec)");
ok(Math.max(...posAcc.max.map(Math.abs)) < 10, `positions are in metres, not mm (max |xyz| = ${Math.max(...posAcc.max.map(Math.abs)).toFixed(2)})`);

// ── Read a POSITION value out of the BIN to confirm the byte layout ──────────
const bv = gltf.bufferViews[posAcc.bufferView];
const x0 = bin.readFloatLE(bv.byteOffset);
ok(Number.isFinite(x0) && Math.abs(x0) < 10, `first POSITION.x decodes sanely (${x0.toFixed(3)} m)`);

ok(gltf.asset.extras?.voxeled?.units === "mm", "voxeled meta rides in asset.extras (units=mm)");

console.log(`gltf: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
