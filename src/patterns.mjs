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

export const PATTERNS = { ribbonChase, planeSweep, normalRGB };
