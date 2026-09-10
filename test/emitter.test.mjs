// Emitter profiles — how a fixture's LEDs emit (the simulator's physics knobs) must flow from
// the fixture type into the scene, with layout- and instance-level overrides merging on top.
// Also pins the lobe math the viewer shader uses: 120° viewing angle ⇒ exactly Lambertian.
import { readFileSync } from "node:fs";
import { parseYAML } from "../src/yaml.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const load = (doc) => resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS }).scene;

const doc = parseYAML(readFileSync("examples/mobius-heart/layouts/two-hearts.yaml", "utf8"));
const scene = load(doc);
const e0 = scene.meta.instances[0].emitter;
ok(e0 && e0.viewingAngleDeg === 120, "heart fixture carries its emitter profile (120° panel LED)");
ok(scene.meta.instances.every((i) => i.emitter?.sizeFrac === 1.0), "every instance inherits the fixture-type emitter (contiguous panel tiles)");

// per-instance override merges OVER the fixture default (a spot on heart 1 only)
const doc2 = { ...doc, instances: doc.instances.map((i, k) => (k === 0 ? { ...i, emitter: { viewingAngleDeg: 10 } } : i)) };
const s2 = load(doc2);
ok(s2.meta.instances[0].emitter.viewingAngleDeg === 10 && s2.meta.instances[0].emitter.sizeFrac === 1.0, "instance `emitter` overrides one field, keeps the rest");
ok(s2.meta.instances[1].emitter.viewingAngleDeg === 120, "other instances untouched");

// layout-level fixtures.X.emitter sits between type default and instance
const doc3 = { ...doc, fixtures: { ...doc.fixtures, heart: { ...doc.fixtures.heart, emitter: { softness: 0.9 } } } };
const s3 = load(doc3);
ok(s3.meta.instances[0].emitter.softness === 0.9 && s3.meta.instances[0].emitter.viewingAngleDeg === 120, "layout fixtures.X.emitter overrides the type default");

// the lobe exponent (mirrors viewer/index.html): p = ln½ / ln cos(θ/2)
const lobeP = (deg) => Math.log(0.5) / Math.log(Math.cos((deg * Math.PI) / 360));
ok(Math.abs(lobeP(120) - 1) < 1e-9, "lobe: 120° viewing angle ⇒ p = 1 (exactly Lambertian)");
ok(lobeP(10) > 100 && lobeP(170) < 0.3, "lobe: 10° ⇒ steep spot (p>100); 170° ⇒ flat rope (p<0.3)");
ok(Math.abs(Math.pow(Math.cos(Math.PI / 3), lobeP(120)) - 0.5) < 1e-9, "at half the viewing angle the lobe is 50% — the datasheet definition");

console.log(`\n${fail === 0 ? "✅" : "❌"} emitter: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
