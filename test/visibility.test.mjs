// Visibility — the virtual-camera primitive. Projection (uv/depth), facing, occlusion via the depth
// buffer, frustum culling, and projection-mapping a texture onto only the visible surface.
import { lookAt, project, facing, computeVisibility, projectTexture, frameCamera } from "../src/visibility.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const scene = (pixels) => ({ pixels: pixels.map((x, i) => ({ i, inst: 0, ...x })), meta: {} });

// camera at +Z=10 looking toward the origin (view direction −Z)
const cam = lookAt({ eye: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 90 });

// ── projection ────────────────────────────────────────────────────────────────
const c = project(cam, [0, 0, 0]);
ok(near(c.u, 0.5) && near(c.v, 0.5) && near(c.z, 10), "point on the axis → screen centre, depth = 10");
const rgt = project(cam, [5, 0, 0]);
ok(rgt.u > 0.5, "a point to the +X → right of centre (u>0.5)");
const upp = project(cam, [0, 5, 0]);
ok(upp.v < 0.5, "a point to the +Y → above centre (v<0.5, image space)");
ok(project(cam, [0, 0, 20]).inFront === false, "a point behind the camera is not in front");

// ── facing ──────────────────────────────────────────────────────────────────
ok(facing(cam, [0, 0, 0], [0, 0, 1]) > 0, "normal toward the eye → front-facing (>0)");
ok(facing(cam, [0, 0, 0], [0, 0, -1]) < 0, "normal away from the eye → back-facing (<0)");

// ── occlusion: a near point hides a far point on the same view ray ─────────────
const occ = computeVisibility(scene([
  { p: [0, 0, 0], n: [0, 0, 1] },   // 0: near (depth 10)
  { p: [0, 0, -5], n: [0, 0, 1] },  // 1: far  (depth 15), directly behind 0
]), cam, { width: 64, height: 64, splat: 2 });
ok(occ[0].visible === true, "the near point is visible");
ok(occ[1].visible === false, "the far point directly behind it is occluded");

// ── co-surface: two points at the same depth, different cells → both visible ───
const flat = computeVisibility(scene([
  { p: [-4, 0, 0], n: [0, 0, 1] },
  { p: [4, 0, 0], n: [0, 0, 1] },
]), cam, { width: 64, height: 64, splat: 2 });
ok(flat[0].visible && flat[1].visible, "two points at equal depth in different cells are both visible");

// ── back-face cull + frustum ──────────────────────────────────────────────────
const cull = computeVisibility(scene([
  { p: [0, 0, 0], n: [0, 0, -1] },   // faces away
  { p: [0, 0, 20], n: [0, 0, 1] },   // behind camera
  { p: [100, 0, 0], n: [0, 0, 1] },  // outside 90° frustum at this depth
]), cam, { width: 64, height: 64 });
ok(cull[0].visible === false, "back-facing point is culled");
ok(cull[1].visible === false, "point behind the camera is culled");
ok(cull[2].visible === false, "point outside the frustum is culled");
ok(computeVisibility(scene([{ p: [0, 0, 0], n: [0, 0, -1] }]), cam, { backface: false })[0].visible, "backface:false keeps the away-facing point");

// ── projection-mapping: visible pixels take the texture; occluded get `off` ────
const tex = (u, v) => [u, v, 0];
const cols = projectTexture(scene([
  { p: [0, 0, 0], n: [0, 0, 1] },   // visible → sampled
  { p: [0, 0, -5], n: [0, 0, 1] },  // occluded → off
]), cam, tex, { off: [1, 1, 1], width: 64, height: 64, splat: 2 });
ok(near(cols[0][0], 0.5) && near(cols[0][1], 0.5), "visible pixel samples the texture at its uv (centre → 0.5,0.5)");
ok(cols[1][0] === 1 && cols[1][1] === 1, "occluded pixel gets the off colour");

// ── frameCamera auto-frames a scene's bounds ──────────────────────────────────
const fc = frameCamera(scene([{ p: [-100, 0, -100], n: [0, 0, 1] }, { p: [100, 200, 100], n: [0, 0, 1] }]), { angleDeg: 0 });
ok(fc.eye[2] > 100 && Math.abs(fc.eye[0]) < 1, "frameCamera at angle 0 sits in front (+Z) of the bounds centre");

console.log(`\n${fail === 0 ? "✅" : "❌"} visibility: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
