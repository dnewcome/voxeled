// The placement layer over a structure: paths (inline / from a tubes.json-style file), arclength
// sampling, parallel-transport frames, the `rope` fixture (LEDs offset + wrapped around a path,
// normals radial), and the `along:` generator (instances spaced along a path, oriented to it).
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPaths, samplePath, transportFrames, pathLength } from "../src/paths.mjs";
import { ropeFixture } from "../src/fixtures/rope.mjs";
import { expandInstances, resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const eqArr = (a, b, e = 1e-6) => a.length === b.length && a.every((x, i) => near(x, b[i], e));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── sampling + frames ─────────────────────────────────────────────────────────
const straight = [[0, 0, 0], [1000, 0, 0]];
ok(pathLength(straight) === 1000, "pathLength of a 1 m line is 1000 mm");
const s11 = samplePath(straight, { count: 11 });
ok(s11.length === 11 && near(s11[3].p[0], 300) && eqArr(s11[3].t, [1, 0, 0]), "count sampling spreads evenly with unit tangents");
const sp = samplePath(straight, { spacingMM: 152 });
ok(sp.length === 7 && near(sp[6].s, 912), "spacing sampling: floor(1000/152)+1 = 7 points, last at 912 mm");
const bent = [[0, 0, 0], [500, 0, 0], [500, 500, 0], [500, 500, 500]];
const fr = transportFrames(samplePath(bent, { count: 40 }));
ok(fr.every((f) => near(dot(f.N, f.t), 0, 1e-6) && near(dot(f.B, f.t), 0, 1e-6) && near(dot(f.N, f.B), 0, 1e-6)), "parallel-transport frames stay orthonormal around two 90° bends");
let maxJump = 0; for (let i = 1; i < fr.length; i++) maxJump = Math.max(maxJump, 1 - dot(fr[i].N, fr[i - 1].N));
ok(maxJump < 0.5, `N is continuous along the path (max 1−N·N' = ${maxJump.toFixed(3)}, no Frenet flips)`);

// ── rope: offset from the axis at an angle, normal radial ────────────────────
const rope = ropeFixture({ path: straight, count: 5, radiusMM: 10, angleDeg: 0 });
// N₀ = up projected ⟂ the tangent (place_leds.py's cross(cross(T, up), T)): angle 0 = on TOP of the tube
ok(rope.pixels.length === 5 && eqArr(rope.pixels[0].p, [0, 10, 0], 1e-3), "angle 0 → on top of the tube (offset along N = up ⟂ T)");
ok(eqArr(rope.pixels[0].n, [0, 1, 0], 1e-3), "the emission normal is the radial direction (away from the tube)");
const rope90 = ropeFixture({ path: straight, count: 5, radiusMM: 10, angleDeg: 90 });
ok(eqArr(rope90.pixels[0].p, [0, 0, 10], 1e-3) && eqArr(rope90.pixels[0].n, [0, 0, 1], 1e-3), "angle 90 → on the side, along B = T×N (+Z for a line along +X)");
const twisted = ropeFixture({ path: straight, count: 3, radiusMM: 10, angleDeg: 0, twistDegPerM: 90 });
ok(eqArr(twisted.pixels[2].p, [1000, 0, 10], 1e-3), "twistDegPerM winds the rope around the axis along its length (90° at 1 m)");
ok(rope.pixels[0].s === 0 && rope.pixels[4].s === 1 && rope.meta.emitter.viewingAngleDeg === 170, "s runs 0→1; a rope defaults to a wide diffused emitter");
const pitched = ropeFixture({ path: straight, pitchMM: 250, radiusMM: 0 });
ok(pitched.pixels.length === 5 && pitched.meta.pitchMM === 250, "pitchMM sets the LED spacing and the fixture's pitch");

// ── along: instances spaced along a path, +Z following the tangent ────────────
const along = expandInstances([{ fixture: "heart", name: "h", along: { path: straight, count: 3 } }]);
ok(along.length === 3 && eqArr(along[1].pos, [500, 0, 0]) && along[1].rotDeg[1] === 90, "along: 3 instances on the line, yawed 90° so +Z follows +X");
const climbing = expandInstances([{ fixture: "h", along: { path: [[0, 0, 0], [0, 1000, 0]], count: 2 } }]);
ok(near(climbing[0].rotDeg[0], -90, 1e-6), "a path going straight up pitches the instance −90° (its +Z points up)");
ok(expandInstances([{ fixture: "h", along: { path: straight, count: 2, orient: "none" }, rotDeg: [0, 15, 0] }])[1].rotDeg[1] === 15, "orient: none keeps the entry's rotDeg");

// ── named paths from a file (tubes.json shape: [{pts:[…]}, …], metres → mm) ───
const tmp = path.join(tmpdir(), `vox-tubes-${process.pid}.json`);
writeFileSync(tmp, JSON.stringify([{ pts: [[0, 0, 0], [1, 0, 0], [1, 0.5, 0]] }, { pts: [[0, 0, 1], [2, 0, 1]] }]));
const paths = loadPaths({ tube0: { file: tmp, index: 0, scaleToMM: 1000 }, tube1: { file: tmp, index: 1, scaleToMM: 1000 }, inline: [[0, 0, 0], [1, 2, 3]] });
unlinkSync(tmp);
ok(paths.tube0.length === 3 && eqArr(paths.tube0[2], [1000, 500, 0]) && paths.tube1[1][0] === 2000 && paths.inline[1][2] === 3, "loadPaths reads tubes.json entries by index, scales metres → mm, and takes inline points");

// ── end to end: a layout with paths + rope fixtures + an along generator ───────
const doc = {
  name: "ropes", units: "mm",
  paths: { tube: [[0, 0, 0], [2000, 0, 0], [2000, 0, 1500]] },
  fixtures: {
    ropeA: { type: "rope", params: { path: "tube", count: 40, radiusMM: 26, angleDeg: 60 } },
    ropeB: { type: "rope", params: { path: "tube", count: 40, radiusMM: 26, angleDeg: 180 } },
    heart: { type: "mobius-heart", params: { panelsPerSide: 2, pitchMM: 30 } },
  },
  instances: [
    { fixture: "ropeA", name: "A" }, { fixture: "ropeB", name: "B" },
    { fixture: "heart", name: "h", along: { path: "tube", count: 3, startMM: 200, endMM: 3300 } },
  ],
};
const { scene } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS });
ok(scene.meta.instances.length === 5 && scene.pixels.filter((p) => p.inst === 0).length === 40, "two ropes + three hearts along the same named tube resolve into one scene");
ok(scene.meta.instances[0].emitter.viewingAngleDeg === 170 && scene.meta.instances[2].fixture === "heart", "ropes carry the rope emitter; the along-generated hearts are hearts");
let threw = false; try { resolveLayout({ ...doc, fixtures: { ...doc.fixtures, ropeA: { type: "rope", params: { path: "nope", count: 3 } } } }, { fixtures: FIXTURES, patterns: PATTERNS }); } catch (e) { threw = /unknown path "nope"/.test(e.message); }
ok(threw, "an unknown path name is a clear error");

console.log(`\n${fail === 0 ? "✅" : "❌"} rope: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
