// Structures — the sculpture ITSELF (the steel ribbon, the tubes and spine) as CAD meshes drawn
// around the LEDs. In the viewer's dots mode they're translucent context; in the simulator they're
// opaque occluders, so the body hides the LEDs behind it exactly as the real piece does.
//
// A structure is a mesh file (STL / GLB / glTF / OBJ) + a placement. Two scopes:
//   fixtures.X.structures: [...]  — per FIXTURE: placed with every instance (two hearts → two rails)
//   structures: [...]             — per SCENE: placed once in world space (Thread's whole frame)
// Files are resolved relative to the layout file. Units: `scaleToMM` (STL/OBJ default 1 = already
// mm; glTF is metres, default 1000).
import path from "node:path";

const MIME = { stl: "model/stl", glb: "model/gltf-binary", gltf: "model/gltf+json", obj: "text/plain" };
export const structureFormat = (file) => (String(file).match(/\.(\w+)$/)?.[1] || "").toLowerCase();

export function resolveStructure(s, { baseDir } = {}, parent = null, name = null) {
  if (!s || !s.file) throw new Error("structure needs a `file`");
  const file = path.resolve(baseDir || process.cwd(), s.file);
  const format = (s.format || structureFormat(file)).toLowerCase();
  if (!MIME[format]) throw new Error(`structure "${s.file}": unsupported format "${format}" (stl, glb, gltf, obj)`);
  return {
    name: s.name || name || path.basename(file),
    file, format,
    scaleToMM: s.scaleToMM ?? (format === "glb" || format === "gltf" ? 1000 : 1),
    pos: s.pos || [0, 0, 0],
    rotDeg: s.rotDeg || [0, 0, 0],
    opacity: s.opacity ?? 0.3,
    color: s.color || "#6b7a99",
    ...(parent ? { parent } : {}),
  };
}

// Serve every unique structure file at /structure/<i>.<ext> and stamp each entry's `url` (the
// viewer fetches that). Returns bus routes. Call BEFORE serializing the scene for the viewer.
export function structureRoutes(scene) {
  const list = scene.meta?.structures || [];
  const byFile = new Map();
  const routes = [];
  for (const s of list) {
    let url = byFile.get(s.file);
    if (!url) {
      url = `structure/${byFile.size}.${s.format}`;
      byFile.set(s.file, url);
      routes.push({ path: "/" + url, file: s.file, contentType: MIME[s.format] || "application/octet-stream" });
    }
    s.url = url;
  }
  return routes;
}
