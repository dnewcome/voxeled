// Fixture-type registry: how a layout's `type:` becomes geometry. Shared by run.mjs (server)
// and export.mjs. Add new fixture types here — each is a (params) => { pixels, meta } function.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sampleHeart } from "./heart.mjs";
import { gltfToFixture } from "../../src/io/gltf-import.mjs";

export const FIXTURES = {
  "mobius-heart": (params) => sampleHeart(params),
  // Import any glTF/GLB as a fixture: LED points + normals from the file (Blender, etc.).
  //   { type: gltf, params: { file: path/to.glb } }   (path resolved from the working dir)
  gltf: (params) => gltfToFixture(readFileSync(path.resolve(params.file)), params),
};
