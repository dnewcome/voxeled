// `vox check` — is this fixture/scene safe to hand to voxeled (and to strangers)?
//
// Hard problems (fail): no pixels; pixels without an emission normal — the normal is required by
// the format because everything downstream (facing, visibility, the simulator) depends on it.
// Warnings: non-unit normals, normals that disagree with their neighbours along the data order,
// order jumps (strand breaks / scrambled order), duplicate points, no pitch, no emitter profile.
import { makeGrid, neighborsWithin, medianNN } from "./mesh-import.mjs";

const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function checkFixture(obj) {
  const pixels = obj.pixels || [];
  const meta = obj.meta || {};
  const problems = [], warnings = [];
  const stats = { pixels: pixels.length, instances: meta.instances?.length ?? 1 };
  if (!pixels.length) problems.push("no pixels");

  const badP = pixels.filter((p) => !p.p || p.p.length !== 3 || p.p.some((x) => !Number.isFinite(x))).length;
  if (badP) problems.push(`${badP} pixel(s) with an invalid position`);
  const missingN = pixels.filter((p) => !p.n || p.n.length !== 3 || p.n.some((x) => !Number.isFinite(x))).length;
  if (missingN) problems.push(`${missingN} pixel(s) without an emission normal (required)`);
  const nonUnit = pixels.filter((p) => p.n && p.n.length === 3 && Math.abs(Math.hypot(...p.n) - 1) > 0.02).length;
  if (nonUnit) warnings.push(`${nonUnit} non-unit normal(s) (normalise them)`);

  const P = pixels.filter((p) => p.p && p.p.length === 3).map((p) => p.p);
  if (P.length) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of P) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
    stats.sizeMM = [0, 1, 2].map((k) => +(hi[k] - lo[k]).toFixed(1));
  }
  const pitch = meta.pitchMM || (P.length > 1 ? medianNN(P) : 0);
  stats.pitchMM = +pitch.toFixed(3);
  if (!meta.pitchMM) warnings.push(`no meta.pitchMM (estimated ${stats.pitchMM} mm from spacing)`);
  // units sanity: voxeled is millimetres. A real LED pitch is ≳ 2 mm; a thousand-pixel fixture is
  // not 80 mm across. Metres → mm is the classic miss (STL/OBJ carry no units).
  if (pixels.length > 50 && pitch > 0 && (pitch < 1 || (stats.sizeMM && Math.max(...stats.sizeMM) < 20)))
    warnings.push(`units look too small (pitch ${stats.pitchMM} mm, size ${stats.sizeMM?.join("×")} mm) — mesh probably in metres: re-import with --scale 1000`);

  // data-order continuity + normal agreement along the order
  let breaks = 0, agree = 0, pairs = 0;
  const steps = [];
  for (let i = 1; i < pixels.length; i++) {
    const a = pixels[i - 1], b = pixels[i];
    if (!a.p || !b.p) continue;
    const d = d3(a.p, b.p);
    if (pitch && d > 3 * pitch) { breaks++; continue; }
    if (pitch) steps.push(d / pitch);
    if (a.n && b.n) { pairs++; if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] > 0.7) agree++; }
  }
  stats.orderBreaks = breaks;
  stats.runs = pixels.length ? breaks + 1 : 0;
  if (steps.length) {
    const mean = steps.reduce((s, x) => s + x, 0) / steps.length;
    stats.stepIrregularity = +Math.sqrt(steps.reduce((s, x) => s + (x - mean) ** 2, 0) / steps.length).toFixed(3);
    if (stats.stepIrregularity > 0.5) warnings.push(`irregular spacing along the data order (σ = ${stats.stepIrregularity}·pitch) — order may be scrambled`);
  }
  if (pixels.length > 1 && breaks > pixels.length / 4) warnings.push(`${breaks} order jumps (> 3·pitch) for ${pixels.length} pixels — the data order looks scrambled`);
  stats.normalAgreement = pairs ? +(agree / pairs).toFixed(3) : null;
  if (pairs && agree / pairs < 0.8) warnings.push(`only ${(100 * agree / pairs).toFixed(0)}% of neighbouring normals agree (>45° flips) — check orientation / sign policy`);

  // duplicates
  if (P.length > 1 && pitch) {
    const grid = makeGrid(P, Math.max(pitch * 0.1, 1e-6));
    let dup = 0;
    for (let i = 0; i < P.length; i++) for (const j of neighborsWithin(grid, i, pitch * 0.05)) if (j > i) dup++;
    stats.duplicates = dup;
    if (dup) warnings.push(`${dup} duplicate point pair(s) (< 0.05·pitch apart)`);
  }

  stats.hasEmitter = !!(meta.emitter || meta.instances?.some((i) => i.emitter));
  if (!stats.hasEmitter) warnings.push("no emitter profile — the simulator will use defaults (120° Lambertian)");
  stats.hadNormals = meta.hadNormals;
  if (meta.hadNormals === false) warnings.push("normals were INFERRED (source carried none) — verify with the viewer's N quills; flip with normalSign if wrong");

  return { ok: problems.length === 0, problems, warnings, stats };
}

export function formatReport(r, title = "fixture") {
  const L = [`${r.ok ? "✅" : "❌"} ${title}: ${r.ok ? "OK" : "FAILED"}`];
  const s = r.stats;
  L.push(`  pixels ${s.pixels}${s.instances > 1 ? ` in ${s.instances} instances` : ""}` + (s.sizeMM ? ` · size ${s.sizeMM.join(" × ")} mm` : "") + ` · pitch ${s.pitchMM} mm`);
  L.push(`  order: ${s.runs} run(s), ${s.orderBreaks} jump(s)` + (s.stepIrregularity != null ? ` · spacing σ ${s.stepIrregularity}·pitch` : "") + (s.normalAgreement != null ? ` · normals agree ${(100 * s.normalAgreement).toFixed(0)}%` : ""));
  L.push(`  emitter ${s.hasEmitter ? "present" : "none"}` + (s.duplicates ? ` · duplicates ${s.duplicates}` : ""));
  for (const p of r.problems) L.push(`  ✗ ${p}`);
  for (const w of r.warnings) L.push(`  ⚠ ${w}`);
  return L.join("\n");
}
