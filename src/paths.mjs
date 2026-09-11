// Paths — polylines in mm that LEDs (a `rope` fixture) or instances (an `along:` generator) follow.
//
// This is the placement layer over a structure: Thread's steel was the input and its LED ropes
// were DERIVED — wrapped along the tubes' centrelines at angles fixed from as-built photos
// (thread-3d/model/scripts/place_leds.py). Here that becomes data: a layout names its paths
// (inline points, or loaded from a JSON file such as thread-3d's tubes.json), and fixtures /
// generators reference them by name.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sub, add, scale, dot, cross, norm, len } from "./vec.mjs";

// ── loading: `paths: { name: [[x,y,z],…] | { file, index|key, scaleToMM } }` ──────────────
export function loadPaths(spec, { baseDir } = {}) {
  const out = {};
  for (const [name, v] of Object.entries(spec || {})) {
    if (Array.isArray(v)) { out[name] = v.map((p) => [+p[0], +p[1], +p[2]]); continue; }
    if (!v || !v.file) throw new Error(`path "${name}": give inline points or { file }`);
    const file = path.resolve(baseDir || process.cwd(), v.file);
    const data = JSON.parse(readFileSync(file, "utf8"));
    let pts;
    if (Array.isArray(data)) {
      const item = v.index != null ? data[v.index] : data[0];
      pts = Array.isArray(item) ? (Array.isArray(item[0]) ? item : data) : item?.pts || item?.points;
      if (Array.isArray(data[0]) && !Array.isArray(data[0][0])) pts = data; // a flat list of points
    } else pts = v.key != null ? (data[v.key]?.pts || data[v.key]?.points || data[v.key]) : data.pts || data.points;
    if (!Array.isArray(pts) || !pts.length) throw new Error(`path "${name}": no points found in ${v.file}`);
    const s = v.scaleToMM ?? 1;
    out[name] = pts.map((p) => [p[0] * s, p[1] * s, p[2] * s]);
  }
  return out;
}

// A path reference: a name (looked up in `paths`) or inline points.
export function resolvePath(ref, paths = {}) {
  if (Array.isArray(ref)) return ref;
  if (typeof ref === "string") { if (!paths[ref]) throw new Error(`unknown path "${ref}" (have: ${Object.keys(paths).join(", ") || "none"})`); return paths[ref]; }
  throw new Error("path must be a name or a list of [x,y,z] points");
}

// ── geometry ─────────────────────────────────────────────────────────────────────
export function pathLength(P) { let L = 0; for (let i = 1; i < P.length; i++) L += len(sub(P[i], P[i - 1])); return L; }

// Sample the polyline by arclength: `count` points from startMM, spaced `spacingMM` (or spread
// evenly to endMM / the end). Returns [{ p, t (unit tangent), s (mm along) }].
export function samplePath(P, { count, spacingMM, startMM = 0, endMM } = {}) {
  if (!P || P.length < 2) throw new Error("a path needs at least two points");
  const L = pathLength(P);
  const end = Math.min(endMM ?? L, L);
  let n = count, step = spacingMM;
  if (!n && step) n = Math.max(1, Math.floor((end - startMM) / step) + 1);
  if (!n) throw new Error("samplePath: give count or spacingMM");
  if (!step) step = n > 1 ? (end - startMM) / (n - 1) : 0;
  // cumulative arclength
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = Math.min(L, startMM + k * step);
    while (seg < P.length - 2 && cum[seg + 1] < s) seg++;
    const segLen = Math.max(1e-9, cum[seg + 1] - cum[seg]);
    const f = Math.max(0, Math.min(1, (s - cum[seg]) / segLen));
    const p = add(P[seg], scale(sub(P[seg + 1], P[seg]), f));
    // tangent: blend neighbouring segments at vertices for a smoother frame
    let t = norm(sub(P[seg + 1], P[seg]));
    if (f > 0.999 && seg + 2 < P.length) t = norm(add(t, norm(sub(P[seg + 2], P[seg + 1]))));
    out.push({ p, t, s });
  }
  return out;
}

// Parallel-transport frames along sampled points: N stays as continuous as the path allows (no
// flips at inflections, unlike a Frenet frame), B = T × N. Same construction as place_leds.py.
export function transportFrames(samples, { up = [0, 1, 0] } = {}) {
  let N = null;
  return samples.map((sm, i) => {
    const T = sm.t;
    if (!N) { N = cross(T, up); if (len(N) < 1e-6) N = cross(T, [0, 0, 1]); N = norm(cross(N, T)); }
    else { N = norm(sub(N, scale(T, dot(N, T)))); if (len(N) < 1e-6) N = norm(cross(cross(T, up), T)); }
    const B = cross(T, N);
    return { ...sm, N, B };
  });
}
