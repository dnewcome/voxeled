// LX/Chromatik .lxm import (tier 1: built-in GridFixture). A model of grids → a voxeled scene with
// world positions, ASSIGNED normals (LX has none), and the per-fixture patch mapped to `output`.
// Unsupported classes (JsonFixture) must be reported, never fabricated.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importLxm, lxmToInstances, lxPatchToOutput, generateFixture } from "../src/io/lxm-import.mjs";

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

// ── tier 2: JsonFixture (.lxf) — expression templates + recursive component geometry ──
// grid.lxm's JsonFixture stays skipped with no fixturesDir; cube.lxm imports with one.
const cube = importLxm("examples/lx/cube.lxm", { fixturesDir: "examples/lx/fixtures" });
ok(cube.skipped.length === 0 && cube.scene.meta.instances.length === 1, "cube.lxm imports its JsonFixture (Cube → Squares → strips)");
ok(cube.scene.count === 64, `Cube (caps off) = 4 faces × (4 strips × 4 pts) = 64 (got ${cube.scene.count})`);
const faceN = new Set(cube.scene.pixels.map((px) => px.n.map((x) => Math.round(x)).join(",")));
ok(faceN.size === 4 && faceN.has("0,0,1") && faceN.has("1,0,0") && faceN.has("-1,0,0") && faceN.has("0,0,-1"),
  "voxeled ASSIGNS 4 outward face normals to a normal-less LX cube (the payoff)");
ok(cube.scene.pixels.every((px) => Math.abs(px.p[0]) <= 106.01 && Math.abs(px.p[2]) <= 106.01), "cube fits ~106mm (size 100 + 2×3 padding)");

// generateFixture: `instances` + degrees trig + $instance (a Fan-style ring, no file needed)
const ring = generateFixture(
  {
    parameters: { count: { default: 4 }, radius: { default: 100 } },
    components: [{ type: "strip", instances: "$count", numPoints: 1, spacing: 0,
      x: "$radius * cos(360 / $count * $instance)", y: "$radius * sin(360 / $count * $instance)" }],
  },
  {}, { dirs: [] }
);
ok(ring.length === 4, "`instances` repeats a strip 4× (got " + ring.length + ")");
ok(Math.abs(ring[0].p[0] - 100) < 1e-6 && Math.abs(ring[0].p[1]) < 1e-6, "$instance 0 → 0° → (100, 0)");
ok(Math.abs(ring[1].p[0]) < 1e-6 && Math.abs(ring[1].p[1] - 100) < 1e-6, "$instance 1 → 90° → (0, 100) [degrees trig]");

// JSONC tolerance: Cube.lxf carries a /* block comment */ and still parsed above (import succeeded)
ok(cube.scene.count === 64, "JSONC comments in .lxf are tolerated (Cube.lxf has a block comment)");

// ── nothing importable → a helpful throw (names what needs tier 2) ──────────────
const tmp = path.join(tmpdir(), `vox-lxm-${process.pid}.lxm`);
writeFileSync(tmp, JSON.stringify({ fixtures: [{ class: "heronarts.lx.structure.JsonFixture", parameters: { fixtureType: "X" } }] }));
let threw = false;
try { importLxm(tmp); } catch (e) { threw = /no importable fixtures/.test(e.message); }
unlinkSync(tmp);
ok(threw, "an unresolvable model (JsonFixture, no fixturesDir) throws a helpful error");

console.log(`\n${fail === 0 ? "✅" : "❌"} lxm-import: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
