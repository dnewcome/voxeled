// Builder foundations: placement generators (array / ring) expand into plain instances with `src`
// bookkeeping, and the YAML emitter round-trips every shipped layout through the parser unchanged.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseYAML } from "../src/yaml.mjs";
import { stringifyYAML, yamlHeader } from "../src/yaml-emit.mjs";
import { expandInstances, resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const eqArr = (a, b, e = 1e-6) => a.length === b.length && a.every((x, i) => near(x, b[i], e));

// ── array ──────────────────────────────────────────────────────────────────────
const arr = expandInstances([{ fixture: "panel", name: "wall", pos: [100, 0, 0], array: { count: [3, 2, 1], spacing: [500, 400, 0] } }]);
ok(arr.length === 6, "array 3×2×1 → 6 instances");
ok(arr[0].name === "wall-0-0" && arr[5].name === "wall-2-1", "generated names carry x-y indices");
ok(eqArr(arr[1].pos, [600, 0, 0]) && eqArr(arr[3].pos, [100, 400, 0]), "positions step by spacing from the entry's pos");
ok(arr.every((i, k) => i.src.i === 0 && i.src.k === k) && !("array" in arr[0]), "each element records src {i,k}; the generator key is consumed");
const centered = expandInstances([{ fixture: "p", array: { count: [3, 1, 1], spacing: [1000, 0, 0], center: true } }]);
ok(eqArr(centered[0].pos, [-1000, 0, 0]) && eqArr(centered[2].pos, [1000, 0, 0]), "center: true centres the matrix on the entry's pos");
const rotated = expandInstances([{ fixture: "p", rotDeg: [0, 90, 0], array: { count: [2, 1, 1], spacing: [1000, 0, 0] } }]);
ok(near(rotated[1].pos[2], -1000, 1e-6) && near(rotated[1].pos[0], 0, 1e-6), "the matrix lives in the entry's rotated frame (yaw 90° → steps along −Z)");
const each = expandInstances([{ fixture: "p", array: { count: [2, 1, 1], spacing: [10, 0, 0] }, each: { rotDeg: [0, 45, 0], emitter: { viewingAngleDeg: 30 } } }]);
ok(each[0].rotDeg[1] === 45 && each[1].emitter.viewingAngleDeg === 30, "`each` applies per generated instance");

// ── ring ───────────────────────────────────────────────────────────────────────
const ring = expandInstances([{ fixture: "heart", name: "r", pos: [0, 0, 0], ring: { count: 4, radiusMM: 1000, facing: "center" } }]);
ok(ring.length === 4 && eqArr(ring[0].pos, [0, 0, 1000]) && eqArr(ring[1].pos, [1000, 0, 0], 1e-6), "ring of 4 at radius 1000 starting at +Z, going around Y");
ok(ring[0].rotDeg[1] === 180 && ring[1].rotDeg[1] === 270, "facing: center yaws each instance toward the middle");
ok(expandInstances([{ fixture: "h", ring: { count: 3, radiusMM: 5, facing: "out" } }])[1].rotDeg[1] === 120, "facing: out yaws outward");
ok(expandInstances([{ fixture: "h", pos: [1, 2, 3] }])[0].src.i === 0, "a plain instance gets src {i} too");

// ── generators resolve end-to-end into a scene (real fixtures) ─────────────────
const { scene } = resolveLayout({ name: "g", fixtures: { heart: { type: "mobius-heart", params: { panelsPerSide: 2, pitchMM: 30 } } },
  instances: [{ fixture: "heart", array: { count: [2, 2, 1], spacing: [1500, 1500, 0], center: true } }] }, { fixtures: FIXTURES, patterns: PATTERNS });
ok(scene.meta.instances.length === 4 && scene.meta.instances[3].src.k === 3, "resolveLayout expands a 2×2 array into 4 placed instances with src");

// ── YAML emitter: every shipped layout round-trips ─────────────────────────────
const dir = "examples/mobius-heart/layouts";
for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
  const text = readFileSync(path.join(dir, f), "utf8");
  const doc = parseYAML(text);
  const again = parseYAML(stringifyYAML(doc, { header: yamlHeader(text) }));
  ok(JSON.stringify(again) === JSON.stringify(doc), `${f}: parse → emit → parse is identical`);
}
const hdr = yamlHeader("# voxeled layout — two hearts\n# second line\nname: x\n");
ok(hdr === "# voxeled layout — two hearts\n# second line", "yamlHeader keeps the leading comment block");
const out = stringifyYAML({ name: "wipe · across (world)", n: 3, on: true, list: [1, 2], nested: { a: [1, 2, 3], b: "x:y" } });
const back = parseYAML(out);
ok(back.name === "wipe · across (world)" && back.n === 3 && back.on === true && back.nested.b === "x:y", "scalars needing quotes are quoted; typed scalars survive");

console.log(`\n${fail === 0 ? "✅" : "❌"} builder-layout: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
