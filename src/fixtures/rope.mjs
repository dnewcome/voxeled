// `rope` — a run of LEDs along a path, offset from its axis and wrapped around it: a diffused LED
// rope zip-tied along a steel tube, a strip taped along an edge, a string wound round a mast.
//
// Generalizes thread-3d's place_leds.py: parallel-transport frames (T, N, B) along the path; at
// each LED the offset direction is D = cos φ·N + sin φ·B with φ = angleDeg + twistDegPerM·s; the
// LED sits at P + radiusMM·D and its emission normal IS D — a diffused rope emits radially, away
// from the tube it's fixed to. `s` runs 0→1 along the rope so ribbonChase flows down it.
//
//   { type: rope, params: { path: tube-1, count: 600, pitchMM: 152, radiusMM: 26, angleDeg: 60 } }
import { add, scale } from "../vec.mjs";
import { resolvePath, samplePath, transportFrames } from "../paths.mjs";

export function ropeFixture({ path, paths = {}, count, pitchMM, radiusMM = 0, angleDeg = 0, twistDegPerM = 0, startMM = 0, endMM, up = [0, 1, 0] } = {}) {
  const P = resolvePath(path, paths);
  const samples = transportFrames(samplePath(P, { count, spacingMM: pitchMM, startMM, endMM }), { up });
  const n = samples.length;
  const pixels = samples.map((sm, i) => {
    const phi = ((angleDeg + (twistDegPerM * sm.s) / 1000) * Math.PI) / 180;
    const D = add(scale(sm.N, Math.cos(phi)), scale(sm.B, Math.sin(phi)));
    return { i, p: add(sm.p, scale(D, radiusMM)).map((x) => +x.toFixed(3)), n: D.map((x) => +x.toFixed(4)), s: n > 1 ? +(i / (n - 1)).toFixed(5) : 0, v: 0 };
  });
  const pitch = pitchMM || (n > 1 ? +(samples[1].s - samples[0].s).toFixed(3) : 10);
  return {
    pixels,
    meta: {
      source: "rope", pitchMM: pitch, points: n, radiusMM, angleDeg, twistDegPerM,
      // a diffused rope: wide lobe, soft body
      emitter: { viewingAngleDeg: 170, sizeFrac: 0.8, coreFrac: 0.6, softness: 0.7, gain: 1.5, glow: 1.2 },
    },
  };
}
