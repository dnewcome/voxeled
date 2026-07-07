// voxeled scene format (.vxl.json) — v0.
//
// A scene is the source of truth: an array of pixels, each carrying at minimum a world
// position and an emission normal, plus optional domain coordinates (here s,v). Addressing
// is index-implied for v0 (pixel i → byte offset i*3); explicit per-fixture patch comes later.
import { readFileSync, writeFileSync } from "node:fs";

export const VXL_VERSION = "0.0.1";

export function buildScene({ name, units = "mm", pixels, meta = {} }) {
  return { voxeled: VXL_VERSION, name, units, count: pixels.length, meta, pixels };
}

export function saveScene(path, scene) {
  writeFileSync(path, JSON.stringify(scene));
  return path;
}

export function loadScene(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Axis-aligned bounds + centre of a scene's pixels — handy for framing a camera / normalising patterns.
export function bounds(scene) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const px of scene.pixels)
    for (let k = 0; k < 3; k++) {
      if (px.p[k] < lo[k]) lo[k] = px.p[k];
      if (px.p[k] > hi[k]) hi[k] = px.p[k];
    }
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { lo, hi, size, center };
}
