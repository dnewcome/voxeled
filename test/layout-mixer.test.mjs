// Multi-instance layout, fixture-space re-basing, world-vs-fixture pattern space, mixer crossfade.
import { generateScene } from "../examples/mobius-heart/map.mjs";
import { createHub } from "../src/hub.mjs";
import { createShow } from "../src/mixer.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const maxc = (c) => Math.max(c[0], c[1], c[2]);

const scene = generateScene({ hearts: 2, spacingFt: 10 });
const per = scene.meta.perFixture;
const SPACING = 10 * 304.8;
const hub = createHub({ scene, shade: () => [0, 0, 0] });

const a0 = scene.pixels[0], b0 = scene.pixels[per];
ok(scene.meta.instances.length === 2, "2 instances in the rig");
ok(a0.inst === 0 && b0.inst === 1, "pixels tagged with instance index");
ok(near(b0.p[0] - a0.p[0], SPACING, 0.2), `corresponding pixels ${SPACING} mm apart in X`);
ok(near(a0.p[1], b0.p[1], 0.2) && near(a0.p[2], b0.p[2], 0.2), "identical in Y,Z");
const la = hub.ctx.local(a0), lb = hub.ctx.local(b0);
ok(near(la[0], lb[0]) && near(la[1], lb[1]) && near(la[2], lb[2]), "ctx.local() maps both to same local coord");

const world = PATTERNS.worldWipe({ space: "world" }), fixture = PATTERNS.worldWipe({ space: "fixture" });
const t = 1.234;
ok(!near(maxc(world(a0, t, hub.ctx)), maxc(world(b0, t, hub.ctx)), 1e-4), "WORLD: hearts differ (gap accounted)");
ok(near(maxc(fixture(a0, t, hub.ctx)), maxc(fixture(b0, t, hub.ctx)), 1e-6), "FIXTURE: hearts match (synced)");

const control = { mode: "manual", fader: 0, a: 0, b: 1 };
const A = { name: "A", render: () => [1, 0, 0] }, B = { name: "B", render: () => [0, 0, 1] };
const show = createShow({ scenes: [A, B], control });
const at = (x) => { control.fader = x; return show.shade(a0, 0, hub.ctx); };
ok(JSON.stringify(at(0)) === JSON.stringify([1, 0, 0]), "fader 0 → scene A");
ok(JSON.stringify(at(1)) === JSON.stringify([0, 0, 1]), "fader 1 → scene B");
const mid = at(0.5);
ok(near(mid[0], 0.5) && near(mid[2], 0.5), "fader 0.5 → midpoint dissolve");
control.mode = "auto";
const show2 = createShow({ scenes: [A, B], holdS: 4, fadeS: 2, control });
ok(JSON.stringify(show2.shade(a0, 1, hub.ctx)) === JSON.stringify([1, 0, 0]), "auto @t=1s holds A");
const m5 = show2.shade(a0, 5, hub.ctx);
ok(m5[0] > 0 && m5[2] > 0, "auto @t=5s mid-crossfade");

console.log(`layout-mixer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
