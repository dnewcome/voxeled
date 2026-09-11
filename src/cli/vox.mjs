#!/usr/bin/env node
// vox — the voxeled toolchain CLI.
//   vox import <mesh.stl|.obj|.glb | model.lxm> [-o out.vxl.json] [--scale <mm per unit>]
//              [--normal-sign outward|inward|+x|-x|+y|-y|+z|-z] [--order chain|file]
//              [--min-tris N] [--max-tris N] [--emitter '{"viewingAngleDeg":170}'] [--fixtures <dir>]
//   vox check  <scene-or-fixture.vxl.json>
//   vox preview <scene.vxl.json> [--port 8080] [--pattern ribbonChase]   → the viewer (add ?sim=1)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { meshToFixture } from "../io/mesh-import.mjs";
import { importLxm } from "../io/lxm-import.mjs";
import { checkFixture, formatReport } from "../io/check.mjs";
import { buildSceneFromLayout } from "../layout.mjs";
import { saveScene } from "../format.mjs";
import { createBus } from "../bus.mjs";
import { resolveStructure, structureRoutes } from "../structures.mjs";
import { createHub } from "../hub.mjs";
import { PATTERNS } from "../patterns.mjs";

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const usage = () => { console.error("usage: vox import <mesh|.lxm> [-o out.vxl.json] [--scale N] [--normal-sign P] [--order chain|file] [--min-tris N] [--max-tris N] [--emitter JSON]\n       vox check <file.vxl.json>\n       vox preview <file.vxl.json> [--port 8080] [--pattern ribbonChase]"); process.exit(2); };

try {
  if (cmd === "import") {
    const out = opt("-o"), scale = +(opt("--scale", "1")), normalSign = opt("--normal-sign", "outward"), order = opt("--order", "chain");
    const minTris = +(opt("--min-tris", "1")), maxTris = +(opt("--max-tris", "Infinity")), emitterJson = opt("--emitter"), fixturesDir = opt("--fixtures");
    const structureFiles = opt("--structure"), structureScale = opt("--structure-scale"); // the sculpture's own CAD, drawn around the LEDs
    const file = args[0];
    if (!file) usage();
    let scene;
    if (/\.lxm$/i.test(file)) {
      scene = importLxm(file, { fixturesDir }).scene;
    } else {
      const fixture = meshToFixture(readFileSync(file), { file, scaleToMM: scale, normalSign, order, minTris, maxTris });
      if (emitterJson) fixture.meta.emitter = JSON.parse(emitterJson);
      const m = fixture.meta;
      console.log(`vox: ${m.triangles.toLocaleString()} triangles → ${m.islands.toLocaleString()} islands (${m.chip.triangles} tris each, chip ≈ ${m.chip.extentsMM.join("×")} mm)${m.dropped ? `, ${m.dropped} dropped` : ""}`);
      console.log(`     ${m.points.toLocaleString()} LEDs · pitch ${m.pitchMM} mm · ${m.strands} strand(s) [${m.strandLengths.slice(0, 16).join(", ")}${m.strandLengths.length > 16 ? ", …" : ""}] · normals ${m.normalSign} (inferred) · order ${m.order}`);
      scene = buildSceneFromLayout({
        name: m.name, units: "mm",
        instances: [{ name: m.name, fixtureName: "mesh", fixture, pos: [0, 0, 0], ...(fixture.meta.emitter ? { emitter: fixture.meta.emitter } : {}) }],
        meta: { source: "vox import", importedFrom: file, importMeta: m },
      });
    }
    if (structureFiles) scene.meta.structures = structureFiles.split(",").map((f) => resolveStructure({ file: f.trim(), ...(structureScale ? { scaleToMM: +structureScale } : {}) }));
    const r = checkFixture(scene);
    console.log(formatReport(r, file));
    if (scene.meta.structures) console.log(`     structures: ${scene.meta.structures.map((s) => `${s.name} (${s.format}, ×${s.scaleToMM})`).join(", ")}`);
    if (out) console.log(`     wrote ${saveScene(out, scene)}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "check") {
    const file = args[0];
    if (!file) usage();
    const r = checkFixture(JSON.parse(readFileSync(file, "utf8")));
    console.log(formatReport(r, file));
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "preview") {
    // Serve any scene into the viewer with one pattern running. ribbonChase (default) runs a hue
    // chase along each strand's `s` — so the data order the importer inferred is visible.
    const port = +(opt("--port", "8080")), patName = opt("--pattern", "ribbonChase");
    const file = args[0];
    if (!file) usage();
    const make = PATTERNS[patName];
    if (!make) throw new Error(`unknown pattern "${patName}" (have: ${Object.keys(PATTERNS).join(", ")})`);
    const scene = JSON.parse(readFileSync(file, "utf8"));
    scene.meta = { ...(scene.meta || {}), instances: scene.meta?.instances || [], show: { scenes: [patName], single: true } };
    const structRoutes = structureRoutes(scene);
    const viewerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../viewer");
    const bus = createBus({
      port, staticDir: viewerDir,
      routes: [
        { path: "/scene.json", content: JSON.stringify(scene), contentType: "application/json" },
        { path: "/control", handler: (req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); } },
        ...structRoutes,
      ],
    });
    bus.server.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? `vox: port ${port} is in use — pick another with --port` : `vox: ${e.message}`); process.exit(1); });
    const hub = createHub({ scene, shade: make(), fps: 30, bus, senders: [] });
    hub.start();
    console.log(formatReport(checkFixture(scene), file));
    console.log(`vox preview: ${bus.url}   (append ?sim=1 for the simulator · pattern ${patName} · Ctrl-C to stop)`);
    process.on("SIGINT", () => { hub.stop(); bus.close(); process.exit(0); });
  } else usage();
} catch (e) {
  console.error(`vox: ${e.message}`);
  process.exit(1);
}
