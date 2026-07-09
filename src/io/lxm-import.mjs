// LX / Chromatik `.lxm` model importer → a voxeled scene.  See docs/interop/lxm.md.
//
// Tier 1: built-in fixture classes (GridFixture) — geometry from inline params.
// Tier 2: JsonFixture — resolve the referenced `.lxf`, evaluate its expression templates, and
//   generate its component geometry (`strip` primitives + recursive fixture refs like `Square`).
//
// The payoff of importing into voxeled: LX points are positions ONLY (no emission normal), so we
// ASSIGN a meaningful normal (a planar fixture's local +Z, carried through every transform) — the
// orientation LX discards. For a Cube that yields correct outward face normals for free.
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSceneFromLayout } from "../layout.mjs";
import { saveScene } from "../format.mjs";
import { add, matVec, eulerMatrix } from "../vec.mjs";
import { evalField } from "./lxf-expr.mjs";

const short = (cls) => (cls || "").split(".").pop(); // heronarts.lx.structure.GridFixture → GridFixture
const num = (v, d) => (Number.isFinite(v) ? v : d);
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);

// LX enum ordinals → voxeled. Best-effort ordering (confirm exotic values against the jar /
// github.com/heronarts/LX); raw ordinals are preserved in `output.raw` so nothing is lost.
const PROTOCOL = ["none", "artnet", "sacn", "ddp", "opc", "kinet"];
const BYTE_ORDER = ["rgb", "rbg", "grb", "gbr", "brg", "bgr"];

// ── JSONC: LX .lxf/.lxm allow /* */ + // comments and trailing commas ──────────────
function parseJsonc(text) {
  const out = text
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (not the // in a URL/host)
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas
  return JSON.parse(out);
}

const _lxfCache = new Map();
function loadLxf(path) {
  if (_lxfCache.has(path)) return _lxfCache.get(path);
  const lxf = parseJsonc(readFileSync(path, "utf8"));
  _lxfCache.set(path, lxf);
  return lxf;
}

// Resolve a fixture `type` ("Examples/Cube" or bare "Square") to a .lxf file across search dirs.
function resolveLxf(type, ctx) {
  if (!type) return null;
  const rel = type.endsWith(".lxf") ? type : `${type}.lxf`;
  const base = type.split("/").pop();
  const baseRel = base.endsWith(".lxf") ? base : `${base}.lxf`;
  for (const d of ctx.dirs)
    for (const cand of [join(d, rel), join(d, baseRel)]) if (existsSync(cand)) return cand;
  return null;
}

function buildCtx(modelPath, fixturesDir) {
  const dirs = [];
  if (fixturesDir) dirs.push(fixturesDir);
  if (modelPath) {
    const md = dirname(modelPath);
    // Chromatik keeps Models/ and Fixtures/ as siblings, each with the same subfolders.
    dirs.push(md, join(md, "Fixtures"), resolve(md, "../Fixtures"), resolve(md, "../../Fixtures"));
  }
  return { dirs };
}

// ── geometry (all in a fixture's LOCAL frame; +Z is the assigned emission normal) ──
const applyT = ({ R, t }, pt) => ({ p: add(matVec(R, pt.p), t), n: matVec(R, pt.n) });
const fieldT = (f, scope) => ({
  // eulerMatrix is Z·Y·X over [rx,ry,rz]; LX rotations are pitch=X, yaw=Y, roll=Z.
  R: eulerMatrix([evalField(f.pitch, scope, 0), evalField(f.yaw, scope, 0), evalField(f.roll, scope, 0)]),
  t: [evalField(f.x, scope, 0), evalField(f.y, scope, 0), evalField(f.z, scope, 0)],
});

// A `strip` lays numPoints points along local +X at `spacing`; normal is local +Z.
function stripGeom(comp, scope) {
  const n = Math.max(0, Math.round(evalField(comp.numPoints, scope, 1)));
  const sp = evalField(comp.spacing, scope, 0);
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ p: [i * sp, 0, 0], n: [0, 0, 1] });
  return pts;
}

// Generate a component's points: a primitive, or a recursive fixture ref, repeated `instances` times
// with `$instance` bound in scope.
function genComponent(comp, parentScope, ctx, depth) {
  // a component can be conditionally disabled (e.g. Cube's caps: "enabled": "$caps")
  if (comp.enabled !== undefined && evalField(comp.enabled, parentScope, 1) === 0) return [];
  const hasInst = comp.instances !== undefined;
  const count = hasInst ? Math.max(0, Math.round(evalField(comp.instances, parentScope, 1))) : 1;
  const out = [];
  for (let inst = 0; inst < count; inst++) {
    const scope = hasInst ? { ...parentScope, instance: inst } : parentScope;
    const T = fieldT(comp, scope);
    let local;
    if (comp.type === "strip") local = stripGeom(comp, scope);
    else if (comp.type === "point" || comp.type === "points") local = [{ p: [0, 0, 0], n: [0, 0, 1] }];
    else {
      const childPath = resolveLxf(comp.type, ctx);
      if (!childPath) throw new Error(`unresolved fixture ref "${comp.type}" (searched: ${ctx.dirs.join(", ")})`);
      const childLxf = loadLxf(childPath);
      const ov = pickParams(comp, childLxf, scope);
      local = generateFixture(childLxf, ov, { dirs: [dirname(childPath), ...ctx.dirs] }, depth + 1);
    }
    for (const pt of local) out.push(applyT(T, pt));
  }
  return out;
}

// The scope for a fixture's expressions: its parameter defaults, overridden by supplied values.
function fixtureScope(lxf, overrides) {
  const scope = {};
  for (const [k, def] of Object.entries(lxf.parameters || {})) {
    const d = def && def.default;
    scope[k] = typeof d === "boolean" ? (d ? 1 : 0) : typeof d === "number" ? d : 0;
  }
  for (const [k, v] of Object.entries(overrides || {})) if (v !== undefined) scope[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  return scope;
}

// The fields of `source` that name one of `lxf`'s parameters, evaluated in `scope` → overrides.
function pickParams(source, lxf, scope) {
  const ov = {};
  for (const k of Object.keys(lxf.parameters || {})) if (source[k] !== undefined) ov[k] = evalField(source[k], scope, undefined);
  return ov;
}

// Generate all points of a .lxf fixture (recursively), then apply its own conditional `transforms`.
export function generateFixture(lxf, overrides, ctx, depth = 0) {
  if (depth > 16) throw new Error("lxf: nesting too deep (cycle?)");
  const scope = fixtureScope(lxf, overrides);
  let pts = [];
  for (const comp of lxf.components || []) pts.push(...genComponent(comp, scope, ctx, depth));
  for (const tf of lxf.transforms || []) {
    const enabled = tf.enabled === undefined ? true : evalField(tf.enabled, scope, 0) !== 0;
    if (!enabled) continue;
    const T = fieldT(tf, scope);
    pts = pts.map((pt) => applyT(T, pt));
  }
  return pts;
}

// Approximate pixel pitch from consecutive within-strip spacing — for viewer LED sizing.
function estimatePitch(pixels) {
  let min = Infinity;
  for (let i = 1; i < pixels.length; i++) {
    const a = pixels[i - 1].p, b = pixels[i].p;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d > 1e-6 && d < min) min = d;
  }
  return Number.isFinite(min) ? +min.toFixed(3) : undefined;
}

// ── built-in structural fixture classes (tier 1) ──
const BUILTINS = {
  GridFixture(p) {
    const rows = int(p.numRows, 1), cols = int(p.numColumns, 1);
    const rs = num(p.rowSpacing, 10), cs = num(p.columnSpacing, 10);
    const pixels = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        pixels.push({ p: [c * cs, r * rs, 0], n: [0, 0, 1], s: cols > 1 ? c / (cols - 1) : 0, v: rows > 1 ? r / (rows - 1) : 0 });
    return { pixels, pitchMM: Math.min(rs, cs) };
  },
};

// LX per-fixture patch → voxeled `output`, or null for protocol "none". Raw ordinals kept.
export function lxPatchToOutput(p = {}) {
  const proto = int(p.protocol, 0);
  if (!proto) return null;
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
export function lxmToInstances(model, ctx = { dirs: [] }) {
  const instances = [];
  const skipped = [];

  const addInstance = (name, fixtureName, localPixels, pitchMM, p) => {
    const sc = num(p.scale, 1);
    const pixels = sc === 1 ? localPixels : localPixels.map((lp) => ({ ...lp, p: lp.p.map((x) => x * sc) }));
    const output = lxPatchToOutput(p);
    instances.push({
      name: name || fixtureName,
      fixtureName,
      fixture: { pixels, meta: { pitchMM } },
      pos: [num(p.x, 0), num(p.y, 0), num(p.z, 0)],
      rotDeg: [num(p.pitch, 0), num(p.yaw, 0), num(p.roll, 0)],
      ...(output ? { output } : {}),
    });
  };

  (model.fixtures || []).forEach((fx, k) => {
    const cls = short(fx.class);
    const p = fx.parameters || {};
    if (BUILTINS[cls]) {
      const { pixels, pitchMM } = BUILTINS[cls](p);
      addInstance(p.label || `${cls}-${k + 1}`, cls, pixels, pitchMM, p);
      return;
    }
    if (cls === "JsonFixture") {
      const type = p.jsonFixtureType || p.fixtureType;
      const childPath = resolveLxf(type, ctx);
      if (!childPath) { skipped.push({ index: k, class: cls, label: p.label, fixtureType: type, reason: "unresolved .lxf (pass fixturesDir)" }); return; }
      try {
        const lxf = loadLxf(childPath);
        const pixels = generateFixture(lxf, pickParams(p, lxf, {}), { dirs: [dirname(childPath), ...ctx.dirs] });
        if (!pixels.length) throw new Error("generated 0 points");
        addInstance(p.label || type, type, pixels, estimatePitch(pixels), p);
      } catch (e) {
        skipped.push({ index: k, class: cls, label: p.label, fixtureType: type, reason: e.message });
      }
      return;
    }
    skipped.push({ index: k, class: cls, label: p.label, fixtureType: p.jsonFixtureType || p.fixtureType });
  });
  return { instances, skipped };
}

// Import a .lxm file → { scene, skipped }. `fixturesDir` points at the LX Fixtures root for
// JsonFixture (.lxf) resolution (e.g. ~/Chromatik/Fixtures).
export function importLxm(path, { name, fixturesDir } = {}) {
  const model = parseJsonc(readFileSync(path, "utf8"));
  const { instances, skipped } = lxmToInstances(model, buildCtx(path, fixturesDir));
  if (!instances.length) {
    const classes = [...new Set(skipped.map((s) => s.class))].join(", ") || "none";
    throw new Error(`no importable fixtures in ${path}: ${skipped.length} skipped (${classes})`);
  }
  const scene = buildSceneFromLayout({
    name: name || model.name || "lxm-import",
    units: "mm",
    instances,
    meta: { source: "lxm", lxmVersion: model.version },
  });
  return { scene, skipped };
}

// CLI: node src/io/lxm-import.mjs <in.lxm> [out.vxl.json] [--fixtures <dir>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf("--fixtures");
  const fixturesDir = fi >= 0 ? argv.splice(fi, 2)[1] : undefined;
  const [inPath, outPath] = argv;
  if (!inPath) {
    console.error("usage: node src/io/lxm-import.mjs <in.lxm> [out.vxl.json] [--fixtures <dir>]");
    process.exit(2);
  }
  let result;
  try {
    result = importLxm(inPath, { fixturesDir });
  } catch (e) {
    console.error(`voxeled: ${e.message}`);
    process.exit(1);
  }
  const { scene, skipped } = result;
  console.log(`voxeled: imported ${scene.meta.instances.length} fixture(s), ${scene.count} points from ${inPath}`);
  if (skipped.length) {
    const by = {};
    for (const s of skipped) by[s.class] = (by[s.class] || 0) + 1;
    console.log(`  skipped ${skipped.length}: ` + Object.entries(by).map(([c, n]) => `${n}×${c}`).join(", ") + ` (first: ${skipped[0].reason || "unsupported class"})`);
  }
  if (outPath) console.log(`  wrote ${saveScene(outPath, scene)}`);
}
