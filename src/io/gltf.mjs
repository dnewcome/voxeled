// Export a voxeled scene to binary glTF (.glb) — the map travels to Blender / TouchDesigner /
// any glTF tool. Dependency-free: we assemble the GLB container by hand.
//
// Each fixture INSTANCE becomes a named node with a POINTS mesh (one point per LED), carrying
// POSITION + NORMAL + COLOR_0. Positions are baked to world coordinates and scaled to METRES
// (glTF's convention) so the rig opens at real-world scale; the original units + full voxeled
// scene meta ride along in `asset.extras.voxeled` for a lossless round-trip.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const FLOAT = 5126;
const POINTS = 0;

// scene: a resolved voxeled scene ({ voxeled, units, name, count, meta:{instances,...}, pixels }).
// opts.colors: optional Uint8Array of RGB (length count*3) to bake as COLOR_0 (e.g. a rendered frame).
// opts.scale: world-unit → glTF-unit factor (default mm → m).
export function sceneToGLB(scene, { colors = null, scale = 0.001 } = {}) {
  const pixels = scene.pixels;
  const instances = scene.meta?.instances?.length ? scene.meta.instances : [{ name: scene.name || "scene" }];

  // Group pixels by instance.
  const groups = instances.map(() => []);
  for (const px of pixels) (groups[px.inst || 0] || groups[0]).push(px);

  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const chunks = [];
  let byteOffset = 0;

  // Append a Float32Array as a bufferView + accessor; returns the accessor index.
  const addAccessor = (f32, type, count, extra = {}) => {
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length });
    chunks.push(buf);
    byteOffset += buf.length; // every array is float32 → length is a multiple of 4, stays aligned
    accessors.push({ bufferView: bufferViews.length - 1, componentType: FLOAT, count, type, ...extra });
    return accessors.length - 1;
  };

  groups.forEach((group, k) => {
    const n = group.length;
    if (!n) return;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 4);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];

    group.forEach((px, j) => {
      for (let c = 0; c < 3; c++) {
        const v = px.p[c] * scale;
        pos[j * 3 + c] = v;
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
        nor[j * 3 + c] = px.n[c];
      }
      const ci = px.i * 3;
      if (colors && ci + 2 < colors.length) {
        col[j * 4] = colors[ci] / 255;
        col[j * 4 + 1] = colors[ci + 1] / 255;
        col[j * 4 + 2] = colors[ci + 2] / 255;
      } else {
        col[j * 4] = col[j * 4 + 1] = col[j * 4 + 2] = 0.7;
      }
      col[j * 4 + 3] = 1;
    });

    const aPos = addAccessor(pos, "VEC3", n, { min: lo, max: hi });
    const aNor = addAccessor(nor, "VEC3", n);
    const aCol = addAccessor(col, "VEC4", n);
    meshes.push({ name: instances[k]?.name || `inst-${k}`, primitives: [{ mode: POINTS, attributes: { POSITION: aPos, NORMAL: aNor, COLOR_0: aCol } }] });
    nodes.push({ name: instances[k]?.name || `inst-${k}`, mesh: meshes.length - 1 });
  });

  const gltf = {
    asset: {
      version: "2.0",
      generator: "voxeled",
      extras: { voxeled: { version: scene.voxeled, units: scene.units, name: scene.name, exportScale: scale, meta: scene.meta } },
    },
    scene: 0,
    scenes: [{ name: scene.name, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  return assembleGLB(gltf, Buffer.concat(chunks));
}

function pad4(buf, fill) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

function assembleGLB(gltf, bin) {
  const json = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20); // pad with spaces
  const binPadded = pad4(bin, 0);
  const total = 12 + 8 + json.length + 8 + binPadded.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, json, binHeader, binPadded]);
}
