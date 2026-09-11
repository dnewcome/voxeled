// The tool-side exporters: the Grasshopper component's pure core (run with python3), the Blender
// addon's pure core (python3) AND a real headless Blender export (curve + mesh + empty → .vxl.json,
// skipped cleanly if Blender isn't installed), each validated by vox check and loaded back into a
// layout as `type: vxl`.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkFixture } from "../src/io/check.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const dir = mkdtempSync(path.join(tmpdir(), "vox-tools-"));
const py = (code) => spawnSync("python3", ["-c", code], { encoding: "utf8", cwd: process.cwd() });

// ── Grasshopper core: points + normals + strands → fixture ───────────────────
const gh = py(`
import sys, json; sys.path.insert(0, "integrations/grasshopper"); import voxeled_export as ve
P = [(0,0,0),(0.1,0,0),(0.2,0,0),(0,0.5,0),(0.1,0.5,0)]          # metres, two strips
N = [(0,0,1)]*5; S = [0,0,0,1,1]
fx = ve.to_fixture(P, N, S, scale=1000)
est = ve.to_fixture(P, None, S, scale=1000)
print(json.dumps({"fx": fx, "estimated": est["meta"]["hadNormals"], "n0": est["pixels"][0]["n"]}))`);
const g = gh.status === 0 ? JSON.parse(gh.stdout) : null;
ok(g && g.fx.pixels.length === 5 && g.fx.pixels[1].p[0] === 100 && g.fx.pixels[3].strand === 1 && g.fx.pixels[3].s === 0 && g.fx.pixels[4].s === 1, "GH core: metres→mm, strands, s runs 0→1 per strand" + (g ? "" : ` (${gh.stderr.trim()})`));
ok(g && g.fx.meta.pitchMM === 100 && g.fx.meta.hadNormals === true, "GH core: pitch estimated from the data order; normals recorded as given");
ok(g && g.estimated === false && Math.hypot(...g.n0) > 0.99, "GH core: without normals it estimates outward ones and says so (hadNormals false)");
if (g) {
  const r = checkFixture(g.fx);
  ok(r.ok && r.stats.runs === 2, "GH fixture passes vox check (2 runs)");
  const ghFile = path.join(dir, "gh.vxl.json");
  writeFileSync(ghFile, JSON.stringify(g.fx));
  const { scene } = resolveLayout({ name: "t", fixtures: { gh: { type: "vxl", params: { file: ghFile } } }, instances: [{ fixture: "gh", pos: [10, 0, 0] }] }, { fixtures: FIXTURES, patterns: PATTERNS });
  ok(scene.count === 5 && scene.pixels[1].p[0] === 110, "type: vxl loads the exported fixture into a layout (instance transform applied)");
}

// ── Blender core (pure python): islands, faces, curve rope, empty ───────────────
const bl = py(`
import sys, json; sys.path.insert(0, "integrations/blender"); import voxeled_export as ve
def box(cx,cy,cz, L=0.05,W=0.05,T=0.01):
    vs=[[cx+dx*L/2, cy+dy*W/2, cz+dz*T/2] for dx in (-1,1) for dy in (-1,1) for dz in (-1,1)]
    fs=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    return vs, fs
verts, faces = [], []
for k in range(4):
    vs, fs = box(k*0.2, 0, 1.0); off=len(verts); verts += vs; faces += [[i+off for i in f] for f in fs]
chips = {"name":"chips","type":"MESH","mode":"islands","verts":verts,"faces":faces}
panel = {"name":"panel","type":"MESH","mode":"faces","verts":[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],"faces":[[0,1,2,3]],"face_centers":[[0.5,0.5,0]],"face_normals":[[0,0,1]]}
curve = {"name":"tube","type":"CURVE","polylines":[[[0,0,0],[1,0,0]]],"angle":0,"radius":26,"pitch":250}
empty = {"name":"spot","type":"EMPTY","origin":[3,3,3],"zaxis":[0,1,0]}
fx = ve.fixture_from_objects([chips, panel, curve, empty], scale_to_mm=1000)
print(json.dumps(fx))`);
const b = bl.status === 0 ? JSON.parse(bl.stdout) : null;
ok(b && b.meta.strands.length === 4 && b.meta.strands[0].count === 4, "Blender core: 4 modelled chips → 4 island LEDs" + (b ? "" : ` (${bl.stderr.trim().split("\\n").pop()})`));
ok(b && Math.abs(b.pixels[0].n[2]) > 0.99 && b.pixels[0].p[2] === 1000, "…each chip's thin axis (Z) is its normal, centroid at 1000 mm");
ok(b && b.meta.strands[1].count === 1 && b.pixels[4].n[2] === 1 && b.pixels[4].p[0] === 500, "…a quad panel in faces mode → one LED at its centre with the face normal");
ok(b && b.meta.strands[2].count === 5 && b.pixels[5].p[2] === 26 && b.pixels[5].n[2] === 1, "…a curve becomes a rope: pitch 250 mm → 5 LEDs, offset 26 mm radially (angle 0 = up), radial normal");
ok(b && b.pixels.at(-1).n[1] === 1 && b.pixels.at(-1).p[0] === 3000, "…an empty is one LED aimed along its local +Z");

// ── real Blender, headless: build objects, run the addon's collect + core ────────
const blender = ["blender"].find((x) => spawnSync("which", [x]).status === 0);
if (!blender) console.log("  ⊘ SKIP headless Blender export — blender not on PATH");
else {
  const out = path.join(dir, "blender.vxl.json");
  const script = path.join(dir, "drive.py");
  writeFileSync(script, `
import bpy, sys, json
sys.path.insert(0, ${JSON.stringify(path.resolve("integrations/blender"))})
import voxeled_export as ve
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.curve.primitive_bezier_curve_add(); curve = bpy.context.active_object; curve["voxeled_pitch"] = 100.0; curve["voxeled_radius"] = 20.0
bpy.ops.mesh.primitive_grid_add(x_subdivisions=3, y_subdivisions=3, size=1, location=(3,0,0)); grid = bpy.context.active_object; grid["voxeled_mode"] = "faces"
bpy.ops.object.empty_add(location=(0,0,2)); empty = bpy.context.active_object
fx = ve.export_objects([curve, grid, empty], ${JSON.stringify(out)}, pitch_mm=100.0, mesh_mode="vertices")
print("VOX_EXPORT", json.dumps({"points": fx["meta"]["points"], "strands": [(s["name"], s["count"]) for s in fx["meta"]["strands"]], "scale": bpy.context.scene.unit_settings.scale_length}))
`);
  const r = spawnSync(blender, ["-b", "--python", script], { encoding: "utf8", timeout: 180000 });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("VOX_EXPORT"));
  const info = line ? JSON.parse(line.slice(11)) : null;
  ok(info && info.strands.length === 3 && info.strands[1][1] === 9, `headless Blender exported a curve + a 3×3 grid (faces) + an empty: ${info ? info.strands.map((s) => `${s[0]}:${s[1]}`).join(", ") : (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  if (info) {
    const fx = JSON.parse(readFileSync(out, "utf8"));
    const chk = checkFixture(fx);
    ok(chk.ok, `the Blender export passes vox check (${fx.meta.points} LEDs, pitch ${fx.meta.pitchMM} mm)`);
    ok(fx.pixels.every((p) => Math.abs(Math.hypot(...p.n) - 1) < 0.01), "…all normals are unit vectors");
    ok(info.strands[0][1] >= 10 && fx.pixels[0].strand === 0, `…the bezier curve sampled at 100 mm gave ${info.strands[0][1]} rope LEDs`);
  }
}

console.log(`\n${fail === 0 ? "✅" : "❌"} toolchain-exporters: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
