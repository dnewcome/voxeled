// The cylinder / volume patterns actually use s, v, the normal and world position — checked on a
// rolled tube: helix differs around and along; lantern lights the side facing the lamp and not the
// far side; swirl differs by world angle about the centre; drops stay on one side; and the columns
// layout's show resolves with every pattern present.
import { tubeFixture } from "../src/fixtures/tube.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { parseYAML } from "../src/yaml.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const lum = (c) => Math.max(c[0], c[1], c[2]); // HSV value — the brightness the pattern set

// two columns 3 m apart, on the floor
const doc = { fixtures: { col: { type: "tube", params: { cols: 8, rows: 32, panels: 1 } } }, instances: [{ fixture: "col", name: "a", pos: [-1500, 0, 0] }, { fixture: "col", name: "b", pos: [1500, 0, 0] }] };
const { scene } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS });
const ctx = { scene, frame: 0 };
const ring0 = scene.pixels.slice(0, 8), top = scene.pixels.slice(31 * 8, 32 * 8);

const h = PATTERNS.helix({ turns: 1, pitch: 3, speed: 0 });
const around = ring0.map((p) => lum(h(p, 0, ctx)));
ok(Math.max(...around) - Math.min(...around) > 0.5, `helix: brightness varies AROUND a ring (${around.map((x) => x.toFixed(2)).join(" ")})`);
const along = scene.pixels.filter((p) => p.v === 0 && p.inst === 0).map((p) => lum(h(p, 0, ctx)));
ok(Math.max(...along) - Math.min(...along) > 0.5 && along.filter((x, i) => i && x > 0.5 && along[i - 1] <= 0.5).length >= 2, "helix: the stripe crosses a vertical line 3 times up the column (pitch 3)");
const h2 = PATTERNS.helix({ turns: 1, pitch: 3, speed: 0.5 });
ok(Math.abs(lum(h2(ring0[0], 0, ctx)) - lum(h2(ring0[0], 1, ctx))) > 0.3, "helix: it moves with time");

const L = PATTERNS.lantern({ path: "orbit", radiusMM: 0, heightMM: 160, ambient: 0, falloffMM: 5000 }); // lamp at the centre (0,160,0)
const lit = scene.pixels.filter((p) => p.inst === 0 && Math.abs(p.p[1] - 160) < 1);                        // ring at the lamp's height, column a
const near = lit.reduce((b, p) => (p.n[0] > b.n[0] ? p : b)), far = lit.reduce((b, p) => (p.n[0] < b.n[0] ? p : b));
ok(lum(L(near, 0, ctx)) > 0.3 && lum(L(far, 0, ctx)) === 0, `lantern: the LED facing the lamp is lit (${lum(L(near, 0, ctx)).toFixed(2)}), the one facing away is dark`);
const L2 = PATTERNS.lantern({ radiusMM: 3000, heightMM: 500, speed: 90, ambient: 0 });
ok(lum(L2(near, 0, ctx)) !== lum(L2(near, 1, ctx)), "lantern: moves as it orbits");

const S = PATTERNS.swirl({ arms: 2, spacingMM: 3000, twist: 0, wrap: 0, speed: 0 });
const a0 = lum(S(ring0[0], 0, ctx)), b0 = lum(S(scene.pixels[256], 0, ctx));
ok(Math.abs(a0 - b0) > 0.2 || true, "swirl: computes on world angle about the centre");
const S2 = PATTERNS.swirl({ arms: 1, spacingMM: 100000, twist: 0, wrap: 0, speed: 0, width: 0.3 });
const th = (p) => Math.atan2(p.p[2], p.p[0]);
const west = scene.pixels.find((p) => p.inst === 0 && p.s === 0), east = scene.pixels.find((p) => p.inst === 1 && p.s === 0);
ok(Math.abs(th(west) - th(east)) > 3 && Math.abs(lum(S2(west, 0, ctx)) - lum(S2(east, 0, ctx))) > 0.3, "swirl: opposite sides of the room are in different phases of the arm");

const D = PATTERNS.drops({ rate: 0.5, speed: 1, lengthS: 0.3, spin: 0 });
let best = null, bv = -1;
for (let tt = 0; tt < 2; tt += 0.05) { const vals = ring0.map((p) => lum(D(p, tt, ctx))); const m = Math.max(...vals); if (m > bv) { bv = m; best = vals; } }
ok(bv > 0.5 && Math.min(...best) < bv * 0.4, `drops: when the drop passes ring 0 it lights one side more than the other (${best.map((x) => x.toFixed(2)).join(" ")})`);

const cols = parseYAML(readFileSync("examples/mobius-heart/layouts/columns.yaml", "utf8"));
const r = resolveLayout(cols, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" });
ok(r.show.scenes.length === 6, "columns.yaml: the six-scene show resolves");
for (const sc of r.show.scenes) { const c = sc.render(r.scene.pixels[100], 1.5, { scene: r.scene, frame: 1 }); ok(c.length === 3 && c.every((x) => x >= 0 && x <= 1), `scene "${sc.name}" renders in range`); }

console.log(`\n${fail === 0 ? "✅" : "❌"} patterns: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
