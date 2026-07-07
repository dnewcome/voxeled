// Spatial patterns — the core value voxeled keeps from LX Studio.
//
// A pattern is a pure function (pixel, t, ctx) -> [r,g,b] in 0..1. It is a function of the
// pixel's WORLD POSITION (mm) and/or its ribbon coordinate — never a per-index effect on a
// rectangle. Defined in real-world units, motion reads smoothly across irregular spacing.
import { dot } from "./vec.mjs";

// HSV -> RGB, all components 0..1.
export function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A plane of light sweeping up the piece at a real speed (mm/s). Purely world-space — proves
// the animation is spatial, not indexed: it reads correctly across the non-flat, twisting ribbon.
export function planeSweep({ speedMM = 400, widthMM = 180, hue = 0.95 } = {}) {
  return (px, t) => {
    const y = px.p[1]; // +Y is up on this heart
    const phase = y - t * speedMM;
    const band = Math.exp(-((phase / widthMM) ** 2)); // soft moving gaussian band
    return hsv(hue, 0.85, clamp01(band));
  };
}

// A hue chase around the loop in ribbon-arclength s. With the Möbius ½-twist, the wave flows
// around and returns on the "other" apparent side — the geometric payoff, made visible.
export function ribbonChase({ loops = 3, speed = 0.15, sat = 1 } = {}) {
  return (px, t) => hsv(px.s * loops - t * speed, sat, 1);
}

// Shade each pixel by how much its emission normal faces the camera. This exists to *prove the
// map*: if normals are right, front faces glow and back faces go dark as the piece turns.
export function normalShade({ view = [0, 0, 1], hue = 0.58, ambient = 0.08 } = {}) {
  return (px) => hsv(hue, 0.7, clamp01(ambient + Math.max(0, dot(px.n, view))));
}

export const PATTERNS = { planeSweep, ribbonChase, normalShade };
