// LX / Chromatik `.lxm` model importer → a voxeled scene.  See docs/interop/lxm.md.
//
// Tier 1 (this file): built-in fixture classes whose geometry is generated from inline params.
// `GridFixture` is the only structural built-in that appears in real Chromatik rigs; the rest
// (`JsonFixture` and friends) are reported as UNSUPPORTED so nothing imports silently wrong.
// Tier 2 = `JsonFixture` (.lxf): a small expression evaluator + component geometry.
//
// The payoff of importing into voxeled: LX points are positions ONLY (no emission normal), so we
// ASSIGN a meaningful normal here (a grid's local +Z) — the orientation LX threw away.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildSceneFromLayout } from "../layout.mjs";
import { saveScene } from "../format.mjs";

const short = (cls) => (cls || "").split(".").pop(); // heronarts.lx.structure.GridFixture → GridFixture
const num = (v, d) => (Number.isFinite(v) ? v : d);
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);

// LX enum ordinals → voxeled. Best-effort ordering (confirm exotic values against the jar /
// github.com/heronarts/LX); the raw ordinals are preserved in `output.raw` so nothing is lost.
const PROTOCOL = ["none", "artnet", "sacn", "ddp", "opc", "kinet"];
const BYTE_ORDER = ["rgb", "rbg", "grb", "gbr", "brg", "bgr"];

// --- built-in fixture geometry, authored in the fixture's LOCAL frame ---
// Planar fixtures emit local +Z as the emission normal (LX stores none; voxeled assigns one).
const BUILTINS = {
  // LX GridFixture: `numColumns` run along local +X, `numRows` along local +Y, in the XY plane.
  GridFixture(p) {
    const rows = int(p.numRows, 1), cols = int(p.numColumns, 1);
    const rs = num(p.rowSpacing, 10), cs = num(p.columnSpacing, 10);
    const pixels = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        pixels.push({
          p: [c * cs, r * rs, 0],
          n: [0, 0, 1],
          s: cols > 1 ? c / (cols - 1) : 0, // across (column)
          v: rows > 1 ? r / (rows - 1) : 0, // along  (row)
        });
    // NOTE: straight row-major. LX `wiring` (serpentine variants) only changes index ORDER —
    // irrelevant to the map's positions; it matters once channels are patched (a tier-2 refinement).
    return { pixels, meta: { pitchMM: Math.min(rs, cs) } };
  },
};

// LX per-fixture patch → voxeled `output` block, or null for protocol "none" (unwired). Ordinals
// are preserved under `.raw` since the enum mapping above is best-effort.
export function lxPatchToOutput(p = {}) {
  const proto = int(p.protocol, 0);
  if (!proto) return null; // 0 = none
  const out = {
    protocol: PROTOCOL[proto] || `lx:${proto}`,
    host: p.host,
    port: int(p.port, 0) || undefined,
    byteOrder: BYTE_ORDER[int(p.byteOrder, 0)] || undefined,
    raw: { protocol: proto, byteOrder: int(p.byteOrder, 0), transport: int(p.transport, 0) },
  };
  if (out.protocol === "artnet") { out.universe = int(p.artNetUniverse, 0); out.channel = int(p.dmxChannel, 0); }
  else if (out.protocol === "ddp") out.offset = int(p.ddpDataOffset, 0);
  else if (out.protocol === "opc") { out.channel = int(p.opcChannel, 0); out.offset = int(p.opcOffset, 0); }
  return out;
}

// Parse an .lxm object → { instances (ready for buildSceneFromLayout), skipped }.
export function lxmToInstances(model) {
  const instances = [];
  const skipped = [];
  (model.fixtures || []).forEach((fx, k) => {
    const cls = short(fx.class);
    const p = fx.parameters || {};
    const make = BUILTINS[cls];
    if (!make) {
      skipped.push({ index: k, class: cls, label: p.label, fixtureType: p.jsonFixtureType || p.fixtureType });
      return;
    }
    const built = make(p);
    // buildSceneFromLayout applies only rotation + translation, so bake `scale` into local geometry.
    const sc = num(p.scale, 1);
    const pixels = sc === 1 ? built.pixels : built.pixels.map((lp) => ({ ...lp, p: lp.p.map((x) => x * sc) }));
    const output = lxPatchToOutput(p);
    instances.push({
      name: p.label || `${cls}-${k + 1}`,
      fixtureName: cls,
      fixture: { pixels, meta: built.meta },
      // eulerMatrix is Z·Y·X over [rx,ry,rz] → LX (pitch=X, yaw=Y, roll=Z).
      pos: [num(p.x, 0), num(p.y, 0), num(p.z, 0)],
      rotDeg: [num(p.pitch, 0), num(p.yaw, 0), num(p.roll, 0)],
      ...(output ? { output } : {}),
    });
  });
  return { instances, skipped };
}

// Import a .lxm file → { scene, skipped }. Throws if nothing importable (tells you what needs tier 2).
export function importLxm(path, { name } = {}) {
  const model = JSON.parse(readFileSync(path, "utf8"));
  const { instances, skipped } = lxmToInstances(model);
  if (!instances.length) {
    const classes = [...new Set(skipped.map((s) => s.class))].join(", ") || "none";
    throw new Error(`no importable fixtures in ${path}: ${skipped.length} skipped (${classes}) — needs tier 2 (JsonFixture/.lxf)`);
  }
  const scene = buildSceneFromLayout({
    name: name || model.name || "lxm-import",
    units: "mm",
    instances,
    meta: { source: "lxm", lxmVersion: model.version },
  });
  return { scene, skipped };
}

// CLI: node src/io/lxm-import.mjs <in.lxm> [out.vxl.json]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath) {
    console.error("usage: node src/io/lxm-import.mjs <in.lxm> [out.vxl.json]");
    process.exit(2);
  }
  let result;
  try {
    result = importLxm(inPath);
  } catch (e) {
    console.error(`voxeled: ${e.message}`);
    process.exit(1);
  }
  const { scene, skipped } = result;
  const fixtures = scene.meta.instances.length;
  console.log(`voxeled: imported ${fixtures} fixture(s), ${scene.count} points from ${inPath}`);
  if (skipped.length) {
    const by = {};
    for (const s of skipped) by[s.class] = (by[s.class] || 0) + 1;
    console.log(`  skipped ${skipped.length} (tier 2): ` + Object.entries(by).map(([c, n]) => `${n}×${c}`).join(", "));
  }
  if (outPath) console.log(`  wrote ${saveScene(outPath, scene)}`);
}
