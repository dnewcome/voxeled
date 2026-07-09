// Spatial patterns — the core value voxeled keeps from LX Studio.
//
// A pattern is a pure function (pixel, t, ctx) -> [r,g,b] in 0..1. It is a function of the
// pixel's WORLD POSITION (mm) and/or its ribbon coordinate — never a per-index effect on a
// rectangle. Defined in real-world units, motion reads smoothly across irregular spacing.
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

// Planes of light sweeping up the piece at a real speed (mm/s), repeating every `spacingMM` so
// there is always a band on the piece. Purely world-space — proves the animation is spatial, not
// indexed: it reads correctly across the non-flat, twisting ribbon.
export function planeSweep({ speedMM = 300, spacingMM = 500, widthMM = 120, hue = 0.95 } = {}) {
  return (px, t) => {
    const u = (px.p[1] - t * speedMM) / spacingMM; // +Y is up; repeating coordinate up the piece
    const f = u - Math.floor(u); // 0..1 within a band cell
    const d = Math.min(f, 1 - f) * spacingMM; // mm to the nearest band centre
    const band = Math.exp(-((d / widthMM) ** 2)); // soft gaussian bands, sweeping forever
    return hsv(hue, 0.85, clamp01(band));
  };
}

// A hue chase around the loop in ribbon-arclength s. With the Möbius ½-twist, the wave flows
// around and returns on the "other" apparent side — the geometric payoff, made visible.
export function ribbonChase({ loops = 3, speed = 0.15, sat = 1 } = {}) {
  return (px, t) => hsv(px.s * loops - t * speed, sat, 1);
}

// Encode each pixel's emission normal as colour (x,y,z → r,g,b). Always fully lit — the direct
// visual proof of the map: the colour field you see *is* the emission-direction field. As the
// piece turns, watch the colours track the surface (and flip across the Möbius twist).
export function normalRGB() {
  return (px) => [(px.n[0] + 1) / 2, (px.n[1] + 1) / 2, (px.n[2] + 1) / 2];
}

// A plane of light wiping along a world axis — the multi-instance showcase, and where the
// "account for distance" toggle lives:
//   space:'world'   → samples the pixel's WORLD position. One wave crosses instance A, then the
//                     real empty gap between instances (dark, taking real time), then instance B.
//                     The 10-ft spacing is physically accounted for.
//   space:'fixture' → samples the pixel's FIXTURE-LOCAL position (via ctx.local). Every instance
//                     shows the identical wave in sync; the distance between them is ignored.
export function worldWipe({ axis = 0, speedMM = 700, spacingMM = 1600, widthMM = 300, space = "world", hue = 0.33 } = {}) {
  return (px, t, ctx) => {
    const pos = space === "fixture" && ctx?.local ? ctx.local(px) : px.p;
    const u = (pos[axis] - t * speedMM) / spacingMM;
    const f = u - Math.floor(u);
    const d = Math.min(f, 1 - f) * spacingMM;
    return hsv(hue, 0.9, clamp01(Math.exp(-((d / widthMM) ** 2))));
  };
}

// ── visibility patterns: "the piece as a real object seen from a vantage" ──────────────
// Both run one whole-scene depth pass per frame (cached on ctx.frame — the hub renders pixels in
// order, so the first pixel of each frame computes it and the rest reuse it), then read per-pixel.
import { frameCamera, computeVisibility } from "./visibility.mjs";

// A helper that recomputes visibility once per frame for an orbiting auto-framed camera.
function perFrameVisibility({ orbitDegPerSec = 12, angleDeg = 20, elevDeg = 14, fovDeg = 55, res = 128, splat = 2, backface = true }) {
  let cachedFrame = -1, vis = null;
  return (t, ctx) => {
    if (ctx.frame !== cachedFrame || !vis) {
      const cam = frameCamera(ctx.scene, { angleDeg: angleDeg + orbitDegPerSec * t, elevDeg, fovDeg });
      vis = computeVisibility(ctx.scene, cam, { width: res, height: res, splat, backface });
      cachedFrame = ctx.frame;
    }
    return vis;
  };
}

// Light only the pixels the camera can SEE — occluded strands (hidden behind the piece) and
// back-facing pixels go dark. Orbit the vantage and LEDs wink in and out as the sculpture turns:
// the Thread problem, computed instead of hand-managed. Front-facing brightness falls off at grazing.
export function spotlight({ orbitDegPerSec = 12, angleDeg = 20, elevDeg = 14, fovDeg = 55, res = 128, splat = 2, hue = 0.13, hidden = [0.03, 0, 0] } = {}) {
  const vis = perFrameVisibility({ orbitDegPerSec, angleDeg, elevDeg, fovDeg, res, splat, backface: true });
  return (px, t, ctx) => {
    const v = vis(t, ctx)[px.i];
    if (!v || !v.visible) return hidden; // occluded or facing away
    return hsv(hue, 0.5, clamp01(0.35 + 0.65 * v.facing)); // grazing angles dimmer
  };
}

// Projection-map a scrolling texture through the camera onto the visible surface — voxeled as the
// house system a VJ jacks into: a 2D frame sampled onto the real 3D piece, occlusion respected.
export function projector({ orbitDegPerSec = 0, angleDeg = 20, elevDeg = 14, fovDeg = 55, res = 128, splat = 2, scroll = 0.12, off = [0, 0, 0] } = {}) {
  const vis = perFrameVisibility({ orbitDegPerSec, angleDeg, elevDeg, fovDeg, res, splat, backface: true });
  const tex = (u, v, t) => hsv(u + t * scroll, 0.9, clamp01(1 - Math.abs(v - 0.5) * 1.3)); // a scrolling horizontal band
  return (px, t, ctx) => {
    const p = vis(t, ctx)[px.i];
    return p && p.visible ? tex(p.uv[0], p.uv[1], t) : off;
  };
}

export const PATTERNS = { ribbonChase, worldWipe, planeSweep, normalRGB, spotlight, projector };
