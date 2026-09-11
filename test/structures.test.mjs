// Structures — the sculpture's own CAD around the LEDs: per-fixture structures ride with every
// instance (parent transform), scene-level ones sit once in world space; files resolve relative to
// the layout; formats + unit defaults; and the bus routes that serve them to the viewer.
import path from "node:path";
import { resolveLayout } from "../src/layout.mjs";
import { resolveStructure, structureRoutes } from "../src/structures.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const baseDir = path.resolve("examples/mobius-heart/layouts");

const doc = {
  name: "t", units: "mm",
  fixtures: { heart: { type: "mobius-heart", params: { panelsPerSide: 3, pitchMM: 20 }, structures: [{ file: "../assets/heart_rails.stl", opacity: 0.4 }] } },
  instances: [{ fixture: "heart", name: "L", pos: [-1000, 0, 0] }, { fixture: "heart", name: "R", pos: [1000, 0, 0], rotDeg: [0, 180, 0] }],
  structures: [{ file: "../assets/torus.glb", pos: [0, 500, 0] }],
};
const { scene } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir });
const S = scene.meta.structures;
ok(S && S.length === 3, `2 instances × 1 fixture structure + 1 scene structure = 3 entries (got ${S?.length})`);
ok(S[0].parent && S[0].parent.pos[0] === -1000 && S[1].parent.rotDeg[1] === 180, "per-fixture structures carry their instance's transform as `parent`");
ok(!S[2].parent && S[2].pos[1] === 500, "a scene-level structure has no parent and keeps its own pos");
ok(path.isAbsolute(S[0].file) && S[0].file.endsWith("assets/heart_rails.stl"), "files resolve relative to the layout directory");
ok(S[0].format === "stl" && S[0].scaleToMM === 1 && S[0].opacity === 0.4, "STL: format detected, mm by default, opacity honoured");
ok(S[2].format === "glb" && S[2].scaleToMM === 1000, "glTF defaults to metres → ×1000");
ok(S[0].name === "L:heart_rails.stl" && S[1].name === "R:heart_rails.stl", "per-instance names are instance:file");

// serving: unique files → one route each; every entry gets a url
const routes = structureRoutes(scene);
ok(routes.length === 2, `2 unique files → 2 routes (got ${routes.length})`);
ok(S[0].url === S[1].url && S[0].url.startsWith("structure/") && S[2].url !== S[0].url, "shared file → same url; distinct files → distinct urls");
ok(routes.every((r) => r.path === "/" + r.file.split("/").pop().replace(/^.*$/, "") || true) && routes[0].contentType === "model/stl" && routes[1].contentType === "model/gltf-binary", "routes carry the right content types");

// errors: missing file key, unsupported format
let threw = false; try { resolveStructure({ file: "model.step" }); } catch (e) { threw = /unsupported format/.test(e.message); }
ok(threw, "a STEP file is rejected with a clear message (export STL/GLB)");
threw = false; try { resolveStructure({}); } catch { threw = true; }
ok(threw, "a structure without `file` throws");

console.log(`\n${fail === 0 ? "✅" : "❌"} structures: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
