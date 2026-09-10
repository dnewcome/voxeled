// Fixture-type registry: how a layout's `type:` becomes geometry. Shared by run.mjs (server)
// and export.mjs. Add new fixture types here — each is a (params) => { pixels, meta } function.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sampleHeart } from "./heart.mjs";
import { gltfToFixture } from "../../src/io/gltf-import.mjs";

// How a fixture EMITS — the simulator's physics knobs (viewer sim mode; see docs/FORMAT.md).
//   viewingAngleDeg — datasheet full angle at 50% intensity: 120 = a typical SMD LED (Lambertian),
//                     ~10 = a spot, ~1 = laser-like, ~170 = a diffused rope/tube.
//   sizeFrac        — emitter body edge as a fraction of pixel pitch (1.0 = contiguous panel tiles)
//   coreFrac        — lit fraction of the body (the LED chip/lens within the tile)
//   softness        — edge diffusion of the lit core (0 = hard chip, 1 = soft blob)
//   gain / glow     — emissive intensity / bloom contribution
const PANEL_LED = { viewingAngleDeg: 120, sizeFrac: 1.0, coreFrac: 0.42, softness: 0.35, gain: 1.7, glow: 1.0 };
const BARE_LED = { viewingAngleDeg: 120, sizeFrac: 0.6, coreFrac: 0.6, softness: 0.5, gain: 1.6, glow: 1.0 };
const withEmitter = (f, emitter) => ({ ...f, meta: { ...(f.meta || {}), emitter } });

export const FIXTURES = {
  // A flexible LED panel ribbon: contiguous tiles, each with a 120° SMD LED at its centre.
  "mobius-heart": (params) => withEmitter(sampleHeart(params), PANEL_LED),
  // Import any glTF/GLB as a fixture: LED points + normals from the file (Blender, etc.).
  //   { type: gltf, params: { file: path/to.glb } }   (path resolved from the working dir)
  gltf: (params) => withEmitter(gltfToFixture(readFileSync(path.resolve(params.file)), params), BARE_LED),
};
