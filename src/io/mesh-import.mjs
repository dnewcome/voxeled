// Chip-island importer — mechanical CAD → LEDs, with no plugin in anyone's CAD.
//
// Mechanical designers already model every LED chip as a small body (for fit). Export that model
// as a mesh (STL/OBJ/GLB) and each chip comes out as its own closed island of triangles. So:
//   1. cluster the triangle soup into connected islands (shared vertices) — one island per chip;
//   2. each island → an LED: centroid = position; the chip's THIN axis (smallest principal
//      component of its vertices) = the emission normal, sign chosen by a policy (default: outward
//      from the piece's centroid — a mesh carries no orientation, so this is a heuristic you can
//      override and should verify with `vox check` / the viewer's normal quills);
//   3. infer the DATA ORDER the mesh doesn't carry: chain nearest neighbours at ~pitch, starting
//      from strand endpoints, so each strand comes out as an ordered run (or keep file order with
//      strand breaks at jumps, like thread-3d did).
// Proven on the Thread sculpture's SolidWorks export: 7,260 islands × 12 triangles = every chip.
import { norm, sub, dot } from "../vec.mjs";
import { gltfToTriangles } from "./gltf-import.mjs";

// ── mesh readers → flat triangle soup (9 floats per triangle) ────────────────────────
export function parseSTL(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + 50 * n === buf.length) { // binary
      const out = new Float64Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // skip the facet normal
        for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return out;
    }
  }
  // ASCII: every "vertex x y z" line; three per facet
  const text = buf.toString("latin1");
  const out = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (!out.length) throw new Error("STL: no triangles found (not binary, no ASCII facets)");
  return Float64Array.from(out);
}

export function parseOBJ(text) {
  const v = [], out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      v.push([+x, +y, +z]);
    } else if (line.startsWith("f ")) {
      const ids = line.split(/\s+/).slice(1).map((t) => { const i = parseInt(t.split("/")[0], 10); return i < 0 ? v.length + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) // fan-triangulate polygons
        for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(v[i][0], v[i][1], v[i][2]);
    }
  }
  if (!out.length) throw new Error("OBJ: no faces found");
  return Float64Array.from(out);
}

// Sniff the format (magic / extension / content) and return triangles.
export function meshToTriangles(buffer, { format, file = "", scaleToMM = 1 } = {}) {
  const ext = (file.match(/\.(\w+)$/)?.[1] || "").toLowerCase();
  const fmt = format || (buffer.length > 4 && buffer.toString("latin1", 0, 4) === "glTF" ? "glb" : ext === "obj" ? "obj" : ext === "stl" ? "stl" : /^\s*(v|f)\s/m.test(buffer.toString("latin1", 0, 2000)) ? "obj" : "stl");
  if (fmt === "glb") return gltfToTriangles(buffer, { scaleToMM: scaleToMM * 1000 }); // glTF is metres
  const tris = fmt === "obj" ? parseOBJ(buffer.toString("utf8")) : parseSTL(buffer);
  if (scaleToMM !== 1) for (let i = 0; i < tris.length; i++) tris[i] *= scaleToMM;
  return tris;
}

// ── islands: connected components of the triangle soup (shared vertices) ────────────
export function clusterIslands(tris) {
  const nTri = tris.length / 9;
  // quantize vertices relative to the model's extent so exported floats that "should" coincide do
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tris.length; i++) { if (tris[i] < lo) lo = tris[i]; if (tris[i] > hi) hi = tris[i]; }
  const q = Math.max((hi - lo) * 1e-6, 1e-9);
  const ids = new Map();
  const vid = new Int32Array(nTri * 3);
  for (let t = 0; t < nTri * 3; t++) {
    const key = `${Math.round(tris[t * 3] / q)},${Math.round(tris[t * 3 + 1] / q)},${Math.round(tris[t * 3 + 2] / q)}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    vid[t] = id;
  }
  const parent = new Int32Array(ids.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nTri; t++) {
    const a = find(vid[t * 3]), b = find(vid[t * 3 + 1]), c = find(vid[t * 3 + 2]);
    parent[b] = a; parent[c] = a;
  }
  const rootIndex = new Map();
  const islandOfTri = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const r = find(vid[t * 3]);
    let k = rootIndex.get(r);
    if (k === undefined) { k = rootIndex.size; rootIndex.set(r, k); }
    islandOfTri[t] = k;
  }
  return { islandOfTri, count: rootIndex.size, vid };
}

// Symmetric 3×3 eigen-decomposition (Jacobi) → { values, vectors } (vectors[j] pairs values[j]).
function eigSym3(m) {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 60; iter++) {
    let p = 0, q = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(a[1][2]); }
    if (mx < 1e-14) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]]) };
}

// Each island → { c: centroid, thin: unit thin axis (unsigned), extents: [max,mid,min] σ, tris }
export function islandGeometry(tris, islandOfTri, count, vid) {
  const nTri = tris.length / 9;
  // unique vertices per island (via the quantized vertex ids)
  const seen = new Set();
  const verts = Array.from({ length: count }, () => []);
  const triCount = new Int32Array(count);
  for (let t = 0; t < nTri; t++) {
    const k = islandOfTri[t];
    triCount[k]++;
    for (let c = 0; c < 3; c++) {
      const id = vid[t * 3 + c];
      if (seen.has(id)) continue;
      seen.add(id);
      verts[k].push([tris[t * 9 + c * 3], tris[t * 9 + c * 3 + 1], tris[t * 9 + c * 3 + 2]]);
    }
  }
  return verts.map((vs, k) => {
    const c = [0, 0, 0];
    for (const p of vs) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= vs.length; c[1] /= vs.length; c[2] /= vs.length;
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of vs) {
      const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] /= Math.max(1, vs.length);
    const { values, vectors } = eigSym3(cov);
    const order = [0, 1, 2].sort((i, j) => values[j] - values[i]); // descending variance
    return { c, thin: norm(vectors[order[2]]), extents: order.map((i) => Math.sqrt(Math.max(0, values[i]))), tris: triCount[k], verts: vs.length };
  });
}

// ── spatial helpers (also used by `vox check`) ───────────────────────────────────────
export function makeGrid(points, cell) {
  const g = new Map();
  const key = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  points.forEach((p, i) => { const k = key(p); const b = g.get(k); if (b) b.push(i); else g.set(k, [i]); });
  return { g, cell, points };
}
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// indices within R of point i (cell must be ≥ R for a 27-cell search to be exact)
export function neighborsWithin(grid, i, R) {
  const { g, cell, points } = grid;
  const p = points[i];
  const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const b = g.get(`${cx + dx},${cy + dy},${cz + dz}`);
    if (!b) continue;
    for (const j of b) if (j !== i && d3(p, points[j]) <= R) out.push(j);
  }
  return out;
}
// median nearest-neighbour distance (exact, grid-accelerated)
export function medianNN(points) {
  const n = points.length;
  if (n < 2) return 0;
  // Seed the search radius from the MEDIAN of sampled nearest-neighbour distances — the minimum
  // would collapse to ~0 on a model with a few duplicated chips and then only the duplicates
  // would find a neighbour (a real bug caught on the Thread export).
  const S = Math.min(300, n), sampled = [];
  for (let s = 0; s < S; s++) {
    const a = points[Math.floor((s * n) / S)];
    let best = Infinity;
    for (let t = 0; t < n; t++) { const d = d3(a, points[t]); if (d > 1e-9 && d < best) best = d; }
    if (best < Infinity) sampled.push(best);
  }
  if (!sampled.length) return 0;
  sampled.sort((a, b) => a - b);
  const seed = sampled[sampled.length >> 1];
  const R = seed * 3;
  const grid = makeGrid(points, R);
  const nn = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (const j of neighborsWithin(grid, i, R)) { const d = d3(points[i], points[j]); if (d < best) best = d; }
    if (best < Infinity) nn.push(best);
  }
  nn.sort((a, b) => a - b);
  return nn.length ? nn[nn.length >> 1] : seed;
}

// ── order inference: strands as chains of nearest neighbours ────────────────────────
// mode 'chain': from each strand endpoint (≤1 neighbour within 1.6·pitch) walk to the nearest
// unvisited neighbour, preferring to keep going straight (so parallel strands don't zig-zag);
// leftover loops are walked from their lowest index. mode 'file': keep input order, break strands
// at jumps > 3·pitch (the thread-3d method — trusts the export order).
export function inferOrder(P, pitch, { mode = "chain" } = {}) {
  const n = P.length;
  const strand = new Int32Array(n);
  if (mode === "file" || n < 3) {
    let s = 0;
    for (let i = 1; i < n; i++) { if (d3(P[i], P[i - 1]) > 3 * pitch) s++; strand[i] = s; }
    return { order: Array.from({ length: n }, (_, i) => i), strand, strands: n ? strand[n - 1] + 1 : 0 };
  }
  const R = 1.6 * pitch;
  const grid = makeGrid(P, R);
  const nbrs = Array.from({ length: n }, (_, i) => neighborsWithin(grid, i, R));
  const visited = new Uint8Array(n);
  const order = [];
  let s = 0;
  const walk = (start) => {
    let cur = start, prev = null;
    while (cur != null) {
      visited[cur] = 1; order.push(cur); strand[cur] = s;
      let best = null, bestScore = Infinity;
      for (const j of nbrs[cur]) {
        if (visited[j]) continue;
        let score = d3(P[cur], P[j]);
        if (prev != null) score -= 0.5 * pitch * dot(norm(sub(P[cur], P[prev])), norm(sub(P[j], P[cur]))); // straight-ahead bonus
        if (score < bestScore) { bestScore = score; best = j; }
      }
      prev = cur; cur = best;
    }
    s++;
  };
  for (let i = 0; i < n; i++) if (!visited[i] && nbrs[i].length <= 1) walk(i); // endpoints first
  for (let i = 0; i < n; i++) if (!visited[i]) walk(i); // closed loops / leftovers
  return { order, strand, strands: s };
}

// ── the importer ─────────────────────────────────────────────────────────────────────
// options: file/format, scaleToMM (mesh units → mm; glTF is metres and handled), normalSign
// ('outward' | 'inward' | '+x'…'-z'), order ('chain' | 'file'), minTris/maxTris (drop islands
// outside — e.g. keep only chip-sized islands when the structure is in the same mesh), name.
export function meshToFixture(buffer, { file = "", format, scaleToMM = 1, normalSign = "outward", order = "chain", minTris = 1, maxTris = Infinity, name } = {}) {
  const tris = meshToTriangles(buffer, { format, file, scaleToMM });
  const { islandOfTri, count, vid } = clusterIslands(tris);
  const all = islandGeometry(tris, islandOfTri, count, vid);
  const kept = all.filter((g) => g.tris >= minTris && g.tris <= maxTris);
  if (!kept.length) throw new Error(`mesh import: ${count} island(s) found but none within minTris=${minTris}..maxTris=${maxTris}`);

  // normal sign policy
  const centroid = [0, 0, 0];
  for (const g of kept) { centroid[0] += g.c[0]; centroid[1] += g.c[1]; centroid[2] += g.c[2]; }
  centroid.forEach((_, k) => (centroid[k] /= kept.length));
  const AXES = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
  const signRef = (g) => (AXES[normalSign] ? AXES[normalSign] : sub(g.c, centroid));
  const signed = kept.map((g) => {
    const ref = signRef(g);
    const d = dot(g.thin, ref);
    const flip = normalSign === "inward" ? d > 0 : d < 0;
    return { ...g, n: flip ? g.thin.map((x) => -x) : g.thin };
  });

  const P = signed.map((g) => g.c);
  const pitch = medianNN(P);
  const { order: ord, strand, strands } = inferOrder(P, pitch, { mode: order });

  // position along each strand → s in 0..1
  const strandLen = new Int32Array(strands), strandPos = new Int32Array(P.length);
  for (const i of ord) strandPos[i] = strandLen[strand[i]]++;
  const pixels = ord.map((src, i) => {
    const g = signed[src], L = strandLen[strand[src]];
    return {
      i, p: g.c.map((x) => +x.toFixed(3)), n: g.n.map((x) => +x.toFixed(4)),
      s: L > 1 ? +(strandPos[src] / (L - 1)).toFixed(5) : 0, v: 0,
      strand: strand[src], src,
    };
  });
  const lengths = Array.from(strandLen);
  return {
    pixels,
    meta: {
      source: "mesh", name: name || file.replace(/^.*[\\/]/, "") || "mesh", file,
      pitchMM: +pitch.toFixed(3), points: pixels.length, triangles: tris.length / 9,
      islands: count, dropped: count - kept.length, strands, strandLengths: lengths,
      normalSign, order, hadNormals: false, // a mesh carries no emission direction — inferred
      chip: { triangles: kept[0].tris, extentsMM: kept[0].extents.map((x) => +(x * 2).toFixed(2)) },
    },
  };
}
