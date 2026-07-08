// LX/Chromatik .lxm import (tier 1: built-in GridFixture). A model of grids → a voxeled scene with
// world positions, ASSIGNED normals (LX has none), and the per-fixture patch mapped to `output`.
// Unsupported classes (JsonFixture) must be reported, never fabricated.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importLxm, lxmToInstances, lxPatchToOutput } from "../src/io/lxm-import.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const eqArr = (a, b, e = 1e-6) => Array.isArray(a) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e);
const GRID = "heronarts.lx.structure.GridFixture";

// ── import the in-repo example (3 grids + 1 JsonFixture) ───────────────────────
const { scene, skipped } = importLxm("examples/lx/grid.lxm");

ok(scene.meta.instances.length === 3, `3 GridFixtures imported (got ${scene.meta.instances.length})`);
ok(skipped.length === 1 && skipped[0].class === "JsonFixture", "the JsonFixture is skipped, not fabricated");
ok(skipped[0].fixtureType === "Examples/Cube", "skip report carries the .lxf fixtureType for tier 2");
ok(scene.count === 48, `3 × (4×4) = 48 points (got ${scene.count})`);

// geometry: grid A origin pixel, and its +X neighbour one column over (columnSpacing 10)
const a0 = scene.pixels.find((px) => px.inst === 0 && px.i === 0);
ok(eqArr(a0.p, [0, 0, 0]), "grid A first point at local origin → world [0,0,0]");
ok(eqArr(a0.n, [0, 0, 1]), "normal is ASSIGNED as local +Z (LX stored none)");
const a1 = scene.pixels.filter((px) => px.inst === 0)[1];
ok(eqArr(a1.p, [10, 0, 0]), "second column is +10mm on X (columnSpacing)");

// transform: grid B is translated to z=20
const b0 = scene.pixels.find((px) => px.inst === 1);
ok(eqArr(b0.p, [0, 0, 20]), "grid B origin translated to world z=20");

// patch: grid C is wired (protocol 1 = Art-Net, universe 2); A/B are protocol 0 = unwired
const [iA, , iC] = scene.meta.instances;
ok(!iA.output, "protocol 0 (none) → no output block");
ok(iC.output && iC.output.protocol === "artnet", "protocol 1 → artnet output");
ok(iC.output.universe === 2 && iC.output.host === "10.0.0.5" && iC.output.port === 6454, "Art-Net universe/host/port mapped");
ok(iC.output.raw && iC.output.raw.protocol === 1, "raw LX ordinals preserved (mapping is best-effort)");
ok(scene.meta.pitchMM === 10, "pitchMM = min spacing, for viewer LED sizing");

// ── unit: patch mapping ────────────────────────────────────────────────────────
ok(lxPatchToOutput({ protocol: 0 }) === null, "lxPatchToOutput: protocol 0 → null");
ok(lxPatchToOutput({ protocol: 3, ddpDataOffset: 512 }).offset === 512, "DDP maps ddpDataOffset → offset");

// ── unit: scale bakes into local geometry, and yaw/pitch/roll → [pitch,yaw,roll] ─
const scaled = lxmToInstances({ fixtures: [{ class: GRID, parameters: { numRows: 1, numColumns: 2, columnSpacing: 10, scale: 2 } }] });
ok(eqArr(scaled.instances[0].fixture.pixels[1].p, [20, 0, 0]), "scale=2 doubles local spacing (baked in)");
const rotated = lxmToInstances({ fixtures: [{ class: GRID, parameters: { numRows: 1, numColumns: 1, yaw: 90, pitch: 5, roll: -3 } }] });
ok(eqArr(rotated.instances[0].rotDeg, [5, 90, -3]), "LX yaw/pitch/roll → voxeled rotDeg [pitch,yaw,roll]");

// ── nothing importable → a helpful throw (names what needs tier 2) ──────────────
const tmp = path.join(tmpdir(), `vox-lxm-${process.pid}.lxm`);
writeFileSync(tmp, JSON.stringify({ fixtures: [{ class: "heronarts.lx.structure.JsonFixture", parameters: { fixtureType: "X" } }] }));
let threw = false;
try { importLxm(tmp); } catch (e) { threw = /tier 2/.test(e.message); }
unlinkSync(tmp);
ok(threw, "a model of only JsonFixtures throws, pointing at tier 2");

console.log(`\n${fail === 0 ? "✅" : "❌"} lxm-import: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
