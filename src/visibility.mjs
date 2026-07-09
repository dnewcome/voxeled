// Visibility — the "virtual camera over the map" primitive.
//
// This is voxeled's level-3 space-awareness: not just where each LED is (position) or which way it
// faces (normal), but whether it is actually SEEN from a vantage point — accounting for occlusion by
// the rest of the piece. It's the thing a point cloud (Chromatik) can't do and the Thread sculpture
// needed ("strips coming in and out of view as the camera moves").
//
// One primitive, three uses — all just "project the map through a camera and z-test":
//   • occlusion / facing   → light only what the audience sees          (see patterns.spotlight)
//   • projection-mapping   → sample a 2D frame onto the visible surface (see patterns.projector) — the VJ jack-in
//   • camera automapping   → the INVERSE: recover positions from where they land in a real camera
import { sub, add, scale, dot, cross, norm, len } from "./vec.mjs";
import { bounds } from "./format.mjs";

// A pinhole camera looking from `eye` toward `target`. Returns an orthonormal basis (r,u,f) + params.
export function lookAt({ eye, target = [0, 0, 0], up = [0, 1, 0], fovDeg = 55, aspect = 1, near = 1e-3, far = Infinity }) {
  const f = norm(sub(target, eye)); // forward (view direction)
  let r = cross(f, up);
  if (len(r) < 1e-6) r = cross(f, [0, 0, 1]); // eye-up parallel guard
  r = norm(r);
  const u = cross(r, f); // true up (unit, ⟂ to r and f)
  return { eye, f, r, u, fovDeg, aspect, near, far, tanHalf: Math.tan((fovDeg * Math.PI) / 360) };
}

// Project a world point → { depth along view, screen uv in [0,1]², frustum flags }.
export function project(cam, p) {
  const d = sub(p, cam.eye);
  const z = dot(d, cam.f); // depth (mm) along the view direction
  const x = dot(d, cam.r);
  const y = dot(d, cam.u);
  const inFront = z > cam.near;
  const ndcX = inFront ? x / (z * cam.tanHalf * cam.aspect) : 0;
  const ndcY = inFront ? y / (z * cam.tanHalf) : 0;
  const u = ndcX * 0.5 + 0.5;
  const v = 0.5 - ndcY * 0.5; // image space: v grows downward
  const inFrustum = inFront && z <= cam.far && ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1;
  return { z, u, v, inFront, inFrustum };
}

// Cosine between a pixel's emission normal and the direction to the eye. >0 ⇒ the lit face is
// turned toward the camera (front-facing); ≤0 ⇒ facing away.
export function facing(cam, p, n) {
  return dot(n, norm(sub(cam.eye, p)));
}

// Per-pixel visibility from a viewpoint. Occlusion is a depth buffer: each front-facing point splats
// its depth into an image grid; a point is hidden if something nearer occupies its cell (beyond a
// depth tolerance so co-surface points don't occlude each other).
// Returns, per pixel i: { uv:[u,v], depth, facing, visible }.
export function computeVisibility(scene, cam, { width = 128, height = 128, splat = 2, backface = true, depthTolMM = null, relEps = 0.03 } = {}) {
  const pts = scene.pixels;
  const N = pts.length;
  const proj = new Array(N);
  const depth = new Float32Array(width * height).fill(Infinity);
  const cell = (q) => [Math.min(width - 1, Math.max(0, (q.u * width) | 0)), Math.min(height - 1, Math.max(0, (q.v * height) | 0))];

  // pass 1: project every pixel; front-facing in-frustum points write the depth buffer
  for (let i = 0; i < N; i++) {
    const q = project(cam, pts[i].p);
    q.facing = facing(cam, pts[i].p, pts[i].n);
    proj[i] = q;
    if (!q.inFrustum || (backface && q.facing <= 0)) continue;
    const [cx, cy] = cell(q);
    for (let sy = -splat; sy <= splat; sy++)
      for (let sx = -splat; sx <= splat; sx++) {
        const X = cx + sx, Y = cy + sy;
        if (X < 0 || Y < 0 || X >= width || Y >= height) continue;
        const k = Y * width + X;
        if (q.z < depth[k]) depth[k] = q.z;
      }
  }

  // co-surface depth tolerance: a couple of LED pitches, or a fraction of depth, whichever is larger
  const pitch = scene.meta?.pitchMM;
  const floor = depthTolMM ?? (pitch ? 2 * pitch : 0);

  // pass 2: a point is visible if in-frustum, front-facing, and the nearest thing at its cell is not
  // meaningfully closer than it is.
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const q = proj[i];
    let visible = q.inFrustum && !(backface && q.facing <= 0);
    if (visible) {
      const [cx, cy] = cell(q);
      const nearest = depth[cy * width + cx];
      const tol = Math.max(floor, relEps * q.z);
      if (q.z > nearest + tol) visible = false;
    }
    out[i] = { uv: [q.u, q.v], depth: q.z, facing: q.facing, visible };
  }
  return out;
}

// Sample a 2D frame onto the map through a camera: each visible pixel takes the colour of the frame
// at its projected uv; occluded/off-screen pixels get `off`. This IS projection-mapping / the VJ
// framebuffer jack-in — the same machinery as occlusion, read the other way.
// `sample(u, v) -> [r,g,b]` in 0..1.
export function projectTexture(scene, cam, sample, { off = [0, 0, 0], ...opts } = {}) {
  const vis = computeVisibility(scene, cam, opts);
  return vis.map((v) => (v.visible ? sample(v.uv[0], v.uv[1]) : off));
}

// Auto-frame a camera on a scene's bounds at a given orbit angle + elevation — so the visibility
// patterns work on any layout without hand-placed coordinates.
export function frameCamera(scene, { angleDeg = 0, elevDeg = 12, fovDeg = 55, up = [0, 1, 0], distScale = 1.0 } = {}) {
  const b = bounds(scene);
  const diag = Math.max(1, Math.hypot(...b.size));
  const dist = (diag * 0.55) / Math.tan((fovDeg * Math.PI) / 360) * distScale;
  const a = (angleDeg * Math.PI) / 180, e = (elevDeg * Math.PI) / 180;
  const eye = add(b.center, [dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a)]);
  return lookAt({ eye, target: b.center, up, fovDeg });
}
