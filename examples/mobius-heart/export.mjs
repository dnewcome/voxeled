// Export a layout to interchange files: a binary glTF (.glb, opens in Blender/TouchDesigner/etc.)
// and the canonical resolved scene (.vxl.json). A snapshot frame is baked as vertex colours.
//
//   node examples/mobius-heart/export.mjs [layout.yaml] [out.glb]
//   make export LAYOUT=examples/mobius-heart/layouts/grid-3x3.yaml
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseYAML } from "../../src/yaml.mjs";
import { resolveLayout } from "../../src/layout.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { PATTERNS } from "../../src/patterns.mjs";
import { createShow } from "../../src/mixer.mjs";
import { createHub } from "../../src/hub.mjs";
import { sceneToGLB } from "../../src/io/gltf.mjs";
import { saveScene } from "../../src/format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const layoutPath = path.resolve(process.argv[2] || path.join(HERE, "layouts/two-hearts.yaml"));
const doc = parseYAML(readFileSync(layoutPath, "utf8"));
const { scene, show } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS });

// Snapshot the first scene at t=0 to bake as vertex colours.
const scenes = show?.scenes?.length ? show.scenes : [{ name: "chase", render: PATTERNS.ribbonChase() }];
const shade = createShow({ scenes, control: { mode: "auto" } }).shade;
const hub = createHub({ scene, shade });
hub.renderOnce();

const glb = sceneToGLB(scene, { colors: hub.frame });

const outArg = process.argv[3];
const base = outArg
  ? outArg.replace(/\.glb$/i, "")
  : path.join(ROOT, "build", path.basename(layoutPath, path.extname(layoutPath)));
mkdirSync(path.dirname(base + ".glb"), { recursive: true });
writeFileSync(base + ".glb", glb);
saveScene(base + ".vxl.json", scene);

const rel = (p) => path.relative(process.cwd(), p);
console.log(`✓ exported "${scene.name}"`);
console.log(`  ${scene.meta.instances.length} instance(s) · ${scene.count.toLocaleString()} points`);
console.log(`  ${rel(base + ".glb")}  (${(glb.length / 1024).toFixed(0)} KB, glTF 2.0, POINTS + NORMAL + COLOR_0, metres)`);
console.log(`  ${rel(base + ".vxl.json")}  (canonical voxeled scene)`);
