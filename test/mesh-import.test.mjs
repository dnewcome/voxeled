// Chip-island importer: a synthetic CAD export (LED chips as small boxes along two helical
// strands, written as binary STL / ASCII STL / OBJ) must come back as LEDs with the right
// positions, thin-axis normals with the outward sign, recovered strand order, and pitch —
// and `vox check` must pass it, and fail a fixture without normals.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { meshToFixture, parseSTL, parseOBJ, clusterIslands, inferOrder } from "../src/io/mesh-import.mjs";
import { checkFixture } from "../src/io/check.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── a synthetic chip: a box with axes (t, b, n) and dims (L, W, T) → 12 triangles ──────
function boxTris(c, t, b, n, L, W, T) {
  const corner = (i, j, k) => [0, 1, 2].map((a) => c[a] + t[a] * (i ? L / 2 : -L / 2) + b[a] * (j ? W / 2 : -W / 2) + n[a] * (k ? T / 2 : -T / 2));
  const v = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) v.push(corner(i, j, k)); // index = i*4+j*2+k
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const tris = [];
  for (const [a, b2, c2, d] of quads) { tris.push(...v[a], ...v[b2], ...v[c2]); tris.push(...v[a], ...v[c2], ...v[d]); }
  return tris;
}
// chips along a helix of radius R: centre at angle θ, tangent along the curve, normal radial-out
const PITCH = 5, R = 50, N = 40;
function helixChips(zOffset) {
  const tris = [], centres = [], normals = [];
  const dTheta = PITCH / R;
  for (let k = 0; k < N; k++) {
    const th = k * dTheta;
    const c = [R * Math.cos(th), R * Math.sin(th), zOffset + k * 0.3];
    const n = [Math.cos(th), Math.sin(th), 0];
    const t = [-Math.sin(th), Math.cos(th), 0];
    const b = [0, 0, 1];
    tris.push(...boxTris(c, t, b, n, 2, 1.5, 0.4));
    centres.push(c); normals.push(n);
  }
  return { tris, centres, normals };
}
const A = helixChips(0), B = helixChips(600);
const allTris = [...A.tris, ...B.tris];

function binarySTL(tris) {
  const n = tris.length / 9;
  const buf = Buffer.alloc(84 + 50 * n);
  buf.write("voxeled synthetic chips", 0, "latin1");
  buf.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) { const o = 84 + i * 50; for (let k = 0; k < 9; k++) buf.writeFloatLE(tris[i * 9 + k], o + 12 + k * 4); }
  return buf;
}
const asciiSTL = (tris) => "solid s\n" + Array.from({ length: tris.length / 9 }, (_, i) => `facet normal 0 0 0\nouter loop\n${[0, 1, 2].map((v) => `vertex ${tris[i * 9 + v * 3]} ${tris[i * 9 + v * 3 + 1]} ${tris[i * 9 + v * 3 + 2]}`).join("\n")}\nendloop\nendfacet`).join("\n") + "\nendsolid s\n";
function obj(tris) {
  const L = ["# voxeled synthetic"];
  for (let i = 0; i < tris.length; i += 3) L.push(`v ${tris[i]} ${tris[i + 1]} ${tris[i + 2]}`);
  for (let f = 0; f < tris.length / 9; f++) L.push(`f ${f * 3 + 1} ${f * 3 + 2} ${f * 3 + 3}`);
  return L.join("\n") + "\n";
}

// ── readers + clustering ──────────────────────────────────────────────────────
ok(parseSTL(binarySTL(allTris)).length === allTris.length, "binary STL round-trips the triangle soup");
ok(parseSTL(Buffer.from(asciiSTL(A.tris))).length === A.tris.length, "ASCII STL parses");
ok(parseOBJ(obj(A.tris)).length === A.tris.length, "OBJ parses (v/f)");
ok(clusterIslands(Float64Array.from(allTris)).count === 2 * N, `clustering finds one island per chip (${2 * N})`);

// ── the importer on the binary STL (the SolidWorks path) ──────────────────────
const tmp = path.join(tmpdir(), `vox-chips-${process.pid}.stl`);
writeFileSync(tmp, binarySTL(allTris));
const fx = meshToFixture(binarySTL(allTris), { file: tmp });
unlinkSync(tmp);
ok(fx.pixels.length === 2 * N, `${2 * N} LEDs from ${2 * N} chips`);
ok(fx.meta.chip.triangles === 12, "each chip is a 12-triangle island");
ok(Math.abs(fx.meta.pitchMM - PITCH) < 0.15, `pitch recovered ≈ ${PITCH} mm (got ${fx.meta.pitchMM})`);
ok(fx.meta.strands === 2 && fx.meta.strandLengths.every((l) => l === N), `two strands of ${N} recovered by chaining (got ${fx.meta.strandLengths})`);

// positions: every LED lands on a known chip centre; normals: the chip's thin axis, outward
const truth = [...A.centres.map((c, i) => ({ c, n: A.normals[i] })), ...B.centres.map((c, i) => ({ c, n: B.normals[i] }))];
let posErr = 0, nAgree = 0;
for (const px of fx.pixels) {
  let best = null, bd = Infinity;
  for (const t of truth) { const d = d3(px.p, t.c); if (d < bd) { bd = d; best = t; } }
  posErr = Math.max(posErr, bd);
  if (dot(px.n, best.n) > 0.999) nAgree++;
}
ok(posErr < 1e-3, `centroids match chip centres (max err ${posErr.toExponential(1)} mm)`);
ok(nAgree === fx.pixels.length, `every normal is the chip's thin axis, signed outward (${nAgree}/${fx.pixels.length})`);

// order: consecutive LEDs within a strand are one pitch apart, and s runs 0→1
let steps = 0, stepOk = 0;
for (let i = 1; i < fx.pixels.length; i++) {
  const a = fx.pixels[i - 1], b = fx.pixels[i];
  if (a.strand !== b.strand) continue;
  steps++; if (Math.abs(d3(a.p, b.p) - PITCH) < 0.3) stepOk++;
}
ok(steps === 2 * (N - 1) && stepOk === steps, "data order walks each strand one pitch at a time");
ok(fx.pixels[0].s === 0 && fx.pixels[N - 1].s === 1, "s runs 0 → 1 along a strand");

// sign policy + file order + island filtering
const inward = meshToFixture(binarySTL(A.tris), { normalSign: "inward" });
ok(inward.pixels.every((px) => dot(px.n, [Math.cos(0), 0, 0]) <= 1 && dot(px.n, px.p.map((x, k) => (k < 2 ? x : 0))) < 0), "normalSign: inward flips every normal toward the axis");
const fileOrder = meshToFixture(binarySTL(allTris), { order: "file" });
ok(fileOrder.meta.strands === 2 && fileOrder.pixels.every((px, i) => px.src === i), "order: file keeps export order, breaks strands at the jump");
// a 'structure' island: 6 unit boxes placed face-to-face (exactly shared corner vertices) → ONE
// 72-triangle island, which maxTris=40 must drop while keeping the 12-triangle chips
const dense = []; for (let k = 0; k < 6; k++) dense.push(...boxTris([300 + k * 1.0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 1, 1, 1));
ok(clusterIslands(Float64Array.from(dense)).count === 1, "face-to-face boxes cluster into one island (shared vertices)");
const filtered = meshToFixture(binarySTL([...A.tris, ...dense]), { maxTris: 40 });
ok(filtered.pixels.length === N && filtered.meta.dropped === 1, "maxTris drops the structure island, keeps the chips");

// ── vox check ────────────────────────────────────────────────────────────────
const r = checkFixture(fx);
ok(r.ok && r.stats.pixels === 2 * N && r.stats.runs === 2, "vox check passes the import (2 runs, normals present)");
ok(r.warnings.some((w) => /INFERRED/.test(w)), "…but warns that normals were inferred from a mesh");
const noN = { pixels: fx.pixels.map(({ n, ...rest }) => rest), meta: {} };
const r2 = checkFixture(noN);
ok(!r2.ok && r2.problems.some((p) => /normal/.test(p)), "vox check FAILS a fixture without emission normals");
const scrambled = { pixels: [...fx.pixels].sort((a, b) => ((a.i * 7919) % 97) - ((b.i * 7919) % 97)), meta: { pitchMM: PITCH } };
ok(checkFixture(scrambled).warnings.some((w) => /scrambled|jumps/.test(w)), "vox check warns about a scrambled data order");

console.log(`\n${fail === 0 ? "✅" : "❌"} mesh-import: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
