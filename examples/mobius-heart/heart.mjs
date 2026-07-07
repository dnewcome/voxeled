// Möbius LED Heart — parametric ribbon, ported to voxeled.
//
// This is a direct port of ../../mobius-led-heart/cad/heart_path.py plus the ribbon frame
// its simulator uses (index.html buildRibbon: F = T × D). All distances in MILLIMETRES.
//
// The point of using *this* piece as voxeled's first target: because the sculpture is
// generated from a parametric ribbon, every LED's world position AND emission normal are
// exact. There is no camera scan and no averaging of CAD tube normals (the thread-3d
// blocker). The normal is F = T × D — tangent (along the perimeter) crossed with the
// width direction (across the band, which spirals with the Möbius twist).

import { sub, add, scale, cross, len, norm } from "../../src/vec.mjs";

// The classic 6th-order heart curve (heart_path.py: raw_heart).
const rawHeart = (t) => [
  16 * Math.sin(t) ** 3,
  13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
];

// Build a heart centreline scaled so its height == heightMM, centred on the origin, z=0.
// Exposes point / tangent / in-plane-normal / twist-angle / width-dir over perimeter arclength.
export function makeHeart({ heightMM, M = 6000 }) {
  const pts = [];
  for (let i = 0; i <= M; i++) pts.push(rawHeart((2 * Math.PI * i) / M));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const rawH = maxY - minY;
  const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2;
  const s = heightMM / rawH;
  const P = pts.map(([x, y]) => [(x - cx) * s, (y - cy) * s, 0]);

  const cum = [0];
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
  const perim = cum[M];

  const idx = (arc) => {
    arc = Math.max(0, Math.min(perim, arc));
    let lo = 0, hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < arc) lo = mid; else hi = mid;
    }
    const seg = (arc - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    return { lo, hi, seg };
  };

  const point = (arc) => {
    const { lo, hi, seg } = idx(arc);
    return add(P[lo], scale(sub(P[hi], P[lo]), seg));
  };

  const tangent = (arc) => {
    const d = Math.max(1.0, perim * 1e-4);
    const t = sub(point(arc + d), point(arc - d));
    return len(t) > 1e-9 ? norm(t) : [1, 0, 0];
  };

  // In-plane normal: tangent rotated -90° in the XY plane (the radial direction R̂).
  const inPlaneNormal = (arc) => {
    const t = tangent(arc);
    return [t[1], -t[0], 0];
  };

  // Per-side twist angle (radians). tw = {rt, rb, lb, lt} at the 4 control ends.
  const theta = (arc, tw) => {
    const half = perim / 2;
    if (arc <= half) { const f = arc / half; return tw.rt * (1 - f) + tw.rb * f; }
    const f = (arc - half) / half; return tw.lb * (1 - f) + tw.lt * f;
  };

  // Width direction: the band's across-axis, spiralling with the twist. D = Ẑ·cosθ + R̂·sinθ.
  const widthDir = (arc, tw) => {
    const th = theta(arc, tw);
    const R = inPlaneNormal(arc);
    return [R[0] * Math.sin(th), R[1] * Math.sin(th), Math.cos(th)];
  };

  // Lit-face emission normal: F = T × D. Exact, analytic, per pixel.
  const faceNormal = (arc, tw) => norm(cross(tangent(arc), widthDir(arc, tw)));

  return { P, cum, perim, heightMM, point, tangent, inPlaneNormal, theta, widthDir, faceNormal };
}

// Fixed perimeter/height ratio of this heart curve (~3.532), used to derive height from panel budget.
export const PERIM_RATIO = makeHeart({ heightMM: 1, M: 3000 }).perim;

const deg = (d) => (d * Math.PI) / 180;
// Twist presets, matching the simulator (setTwist(rt, rb, lb, lt) in degrees).
export const TWIST = {
  "cookie-cutter": { rt: 0, rb: 0, lb: 0, lt: 0 }, // flat band, both faces distinct
  mobius: { rt: deg(0), rb: deg(90), lb: deg(90), lt: deg(180) }, // ½ twist: one-sided loop
  "flat-full": { rt: deg(0), rb: deg(180), lb: deg(360), lt: deg(180) },
};

// Sample the ribbon into discrete LED pixels.
// Returns { pixels: [{ i, p:[x,y,z]mm, n:[nx,ny,nz], s, v }], meta }.
//   s = normalised arclength around the loop (0..1) — content that flows in s returns on the
//       "other" apparent side through the Möbius twist.
//   v = across the band (-1..1).
export function sampleHeart({
  panelsPerSide = 8,
  panelLenMM = 240,
  bandMM = 120,
  twist = "mobius",
  pitchMM = 10, // demo pitch — coarser than the real P1.875 so the point cloud stays light
} = {}) {
  const L = panelsPerSide * panelLenMM; // placed LED length per side
  const heightMM = (2 * L) / PERIM_RATIO; // derive height so the loop == the panel budget
  const heart = makeHeart({ heightMM });
  const perim = heart.perim;
  const tw = TWIST[twist];
  if (!tw) throw new Error(`unknown twist preset: ${twist}`);

  const cols = Math.max(1, Math.round(perim / pitchMM)); // pixels around the loop
  const rows = Math.max(1, Math.round(bandMM / pitchMM)); // pixels across the band

  const pixels = [];
  let i = 0;
  for (let c = 0; c < cols; c++) {
    const arc = ((c + 0.5) / cols) * perim;
    const p0 = heart.point(arc);
    const D = heart.widthDir(arc, tw);
    const n = heart.faceNormal(arc, tw);
    const s = arc / perim;
    // Boustrophedon (serpentine) across the band — mirrors how a strip actually snakes a panel.
    for (let rr = 0; rr < rows; rr++) {
      const r = c % 2 === 0 ? rr : rows - 1 - rr;
      const v = ((r + 0.5) / rows) * 2 - 1;
      const p = add(p0, scale(D, (v * bandMM) / 2));
      pixels.push({
        i: i++,
        p: p.map((x) => +x.toFixed(2)),
        n: n.map((x) => +x.toFixed(4)),
        s: +s.toFixed(5),
        v: +v.toFixed(4),
      });
    }
  }

  return {
    pixels,
    meta: { panelsPerSide, panelLenMM, bandMM, twist, pitchMM, cols, rows, perimMM: +perim.toFixed(1), heightMM: +heightMM.toFixed(1) },
  };
}
