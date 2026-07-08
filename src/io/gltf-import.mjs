// Import a glTF/GLB into a voxeled fixture — bring geometry authored anywhere (Blender, etc.)
// in as LED points with normals. Dependency-free GLB reader.
//
// Every point of every mesh primitive (POINTS or the vertices of a mesh) becomes an LED, with
// its NORMAL if present (else estimated outward from the centroid). Node transforms are applied,
// and positions are scaled from glTF metres to voxeled millimetres. Result plugs in as a fixture:
//   { pixels: [{ i, p:[x,y,z]mm, n:[..], s, v }], meta }
import { norm } from "../vec.mjs";

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGLB(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const jsonLen = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error("expected a JSON chunk");
  const gltf = JSON.parse(buffer.slice(20, 20 + jsonLen).toString("utf8"));
  let bin = Buffer.alloc(0);
  const binHdr = 20 + jsonLen;
  if (binHdr + 8 <= buffer.length && buffer.readUInt32LE(binHdr + 4) === 0x004e4942) {
    const binLen = buffer.readUInt32LE(binHdr);
    bin = buffer.slice(binHdr + 8, binHdr + 8 + binLen);
  }
  return { gltf, bin };
}

// Read an accessor into a flat Float64Array (+ comps/count).
function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const bv = gltf.bufferViews[acc.bufferView];
  const comps = COMPS[acc.type];
  const compSize = acc.componentType === 5126 || acc.componentType === 5125 ? 4 : acc.componentType === 5123 || acc.componentType === 5122 ? 2 : 1;
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || comps * compSize;
  const out = new Float64Array(acc.count * comps);
  const read = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5122: (o) => bin.readInt16LE(o), 5121: (o) => bin.readUInt8(o), 5120: (o) => bin.readInt8(o) }[acc.componentType];
  for (let i = 0; i < acc.count; i++)
    for (let c = 0; c < comps; c++) out[i * comps + c] = read(start + i * stride + c * compSize);
  return { data: out, comps, count: acc.count };
}

// ── minimal column-major 4×4 matrix math ─────────────────────────────────────
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul4(a, b) {
  const m = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return m;
}
function quatMat(x, y, z, w) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const r = quatMat(qx, qy, qz, qw);
  const s = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  const rs = mul4(r, s);
  rs[12] = tx; rs[13] = ty; rs[14] = tz;
  return rs;
}
const tPoint = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const tDir = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];

// Estimate the pixel pitch (median nearest-neighbour distance) so viewers can size LEDs.
// Deterministic sampled scan — cheap even for tens of thousands of points.
function estimatePitch(pixels) {
  const n = pixels.length;
  if (n < 2) return 20;
  const dists = [];
  const S = Math.min(300, n), T = Math.min(1200, n);
  for (let s = 0; s < S; s++) {
    const a = pixels[(s * 7919) % n].p;
    let best = Infinity;
    for (let t = 0; t < T; t++) {
      const b = pixels[(t * 104729 + 1) % n].p;
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > 1e-9 && d < best) best = d;
    }
    if (best < Infinity) dists.push(Math.sqrt(best));
  }
  dists.sort((x, y) => x - y);
  return +(dists[Math.floor(dists.length / 2)] || 20).toFixed(2);
}

export function gltfToFixture(buffer, { scaleToMM = 1000, name } = {}) {
  const { gltf, bin } = parseGLB(buffer);
  const scene = gltf.scenes?.[gltf.scene ?? 0] || { nodes: gltf.nodes?.map((_, i) => i) || [] };
  const pts = [];

  const walk = (nodeIdx, parentM) => {
    const node = gltf.nodes[nodeIdx];
    const m = mul4(parentM, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const posIdx = prim.attributes.POSITION;
        if (posIdx == null) continue;
        const pos = readAccessor(gltf, bin, posIdx);
        const nor = prim.attributes.NORMAL != null ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
        for (let i = 0; i < pos.count; i++) {
          const p = tPoint(m, [pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]]);
          const n = nor ? norm(tDir(m, [nor.data[i * 3], nor.data[i * 3 + 1], nor.data[i * 3 + 2]])) : null;
          pts.push({ p: [p[0] * scaleToMM, p[1] * scaleToMM, p[2] * scaleToMM], n });
        }
      }
    }
    (node.children || []).forEach((c) => walk(c, m));
  };
  (scene.nodes || []).forEach((n) => walk(n, IDENT));
  if (!pts.length) throw new Error("glTF import found no mesh points");

  // Fill any missing normals: outward from the centroid.
  const hadNormals = pts.every((pt) => pt.n);
  if (!hadNormals) {
    const c = [0, 0, 0];
    for (const pt of pts) { c[0] += pt.p[0]; c[1] += pt.p[1]; c[2] += pt.p[2]; }
    c.forEach((_, k) => (c[k] /= pts.length));
    for (const pt of pts) if (!pt.n) pt.n = norm([pt.p[0] - c[0], pt.p[1] - c[1], pt.p[2] - c[2]]);
  }

  const pixels = pts.map((pt, i) => ({
    i,
    p: pt.p.map((x) => +x.toFixed(3)),
    n: pt.n.map((x) => +x.toFixed(4)),
    s: pts.length > 1 ? +(i / (pts.length - 1)).toFixed(5) : 0,
    v: 0,
  }));

  return { pixels, meta: { source: "gltf", name: name || scene.name || "gltf", pitchMM: estimatePitch(pixels), points: pixels.length, hadNormals } };
}
