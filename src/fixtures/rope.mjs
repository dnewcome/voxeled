// `rope` — LEDs along a path, offset from its axis and wrapped around it: a diffused LED rope
// zip-tied along a steel tube, a strip taped along an edge, a string wound round a mast.
//
// Generalizes thread-3d's place_leds.py: parallel-transport frames (T, N, B) along the path; at
// each LED the offset direction is D = cos φ·N + sin φ·B with φ = angleDeg + twistDegPerM·s; the
// LED sits at P + radiusMM·D and its emission normal IS D — a diffused rope emits radially, away
// from the tube it's fixed to. `s` runs 0→1 along each rope so ribbonChase flows down it.
//
//   angleDeg     one angle, or a LIST → several ropes on the same tube (Thread: [60, 180, 300]),
//                each its own strand (pixel.strand), concatenated in data order
//   angleFrom    a path (name or points): angle 0 points TOWARD it — Thread measures rope angles
//                from the inboard direction (tube → spine). Without it, angle 0 = `up` (projected ⟂ T)
//
//   { type: rope, params: { path: tube-1, count: 600, radiusMM: 25, angleDeg: [60, 180, 300], angleFrom: spine } }
import { add, sub, scale, dot, cross, norm, len } from "../vec.mjs";
import { resolvePath, samplePath, transportFrames } from "../paths.mjs";

export function ropeFixture({ path, paths = {}, count, pitchMM, radiusMM = 0, angleDeg = 0, twistDegPerM = 0, startMM = 0, endMM, up = [0, 1, 0], angleFrom = null } = {}) {
  const P = resolvePath(path, paths);
  let frames = transportFrames(samplePath(P, { count, spacingMM: pitchMM, startMM, endMM }), { up });
  if (angleFrom != null) {
    // reference direction per LED: toward the nearest point of the reference path, ⟂ the tangent
    const ref = samplePath(resolvePath(angleFrom, paths), { spacingMM: 50 }).map((s) => s.p);
    frames = frames.map((f) => {
      let best = null, bd = Infinity;
      for (const q of ref) { const d = len(sub(q, f.p)); if (d < bd) { bd = d; best = q; } }
      let r = sub(best, f.p);
      r = sub(r, scale(f.t, dot(r, f.t)));
      if (len(r) < 1e-6) return f; // reference is on the axis here: keep the transported frame
      const N = norm(r);
      return { ...f, N, B: cross(f.t, N) };
    });
  }
  const angles = Array.isArray(angleDeg) ? angleDeg : [angleDeg];
  const n = frames.length;
  const pixels = [];
  angles.forEach((a, strand) => {
    frames.forEach((sm, i) => {
      const phi = ((a + (twistDegPerM * sm.s) / 1000) * Math.PI) / 180;
      const D = add(scale(sm.N, Math.cos(phi)), scale(sm.B, Math.sin(phi)));
      pixels.push({ i: pixels.length, p: add(sm.p, scale(D, radiusMM)).map((x) => +x.toFixed(3)), n: D.map((x) => +x.toFixed(4)), s: n > 1 ? +(i / (n - 1)).toFixed(5) : 0, v: 0, strand });
    });
  });
  const pitch = pitchMM || (n > 1 ? +(frames[1].s - frames[0].s).toFixed(3) : 10);
  return {
    pixels,
    meta: {
      source: "rope", pitchMM: pitch, points: pixels.length, strands: angles.length, perStrand: n, radiusMM, angleDeg: angles, twistDegPerM, angleFrom: typeof angleFrom === "string" ? angleFrom : angleFrom ? "points" : null,
      // a diffused rope: wide lobe, soft body
      emitter: { viewingAngleDeg: 170, sizeFrac: 0.8, coreFrac: 0.6, softness: 0.7, gain: 1.5, glow: 1.2 },
    },
  };
}
