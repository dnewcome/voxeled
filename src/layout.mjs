// Layout (a "rig") — place INSTANCES of fixtures in shared world space.
//
// A fixture is geometry authored once in its own local frame (e.g. one heart). An instance is
// that fixture placed by a world transform (translation in mm + Euler rotation in degrees). This
// is voxeled's version of MVR's model: fixtures + placements. Because instances live in one
// shared world space, a world-space pattern automatically accounts for the real distance between
// them — 2 hearts 10 ft apart really are 10 ft apart to the pattern.
import { add, matVec, eulerMatrix } from "./vec.mjs";
import { buildScene } from "./format.mjs";

// instances: [{ name, fixtureName, fixture:{pixels,meta}, pos:[x,y,z]mm, rotDeg:[rx,ry,rz] }]
// Each instance carries its OWN resolved fixture, so a rig can mix different fixtures.
export function buildSceneFromLayout({ name, units = "mm", instances, meta = {} }) {
  const pixels = [];
  let i = 0;
  instances.forEach((inst, k) => {
    const rot = eulerMatrix(inst.rotDeg || [0, 0, 0]);
    const pos = inst.pos || [0, 0, 0];
    for (const lp of inst.fixture.pixels) {
      const p = add(matVec(rot, lp.p), pos); // world position
      const n = matVec(rot, lp.n); // rotate the emission normal (translation doesn't affect it)
      pixels.push({
        i: i++,
        inst: k, // which instance — lets fixture-space patterns re-base to local coords
        p: p.map((x) => +x.toFixed(2)),
        n: n.map((x) => +x.toFixed(4)),
        s: lp.s,
        v: lp.v,
      });
    }
  });

  // Real pixel pitch (mm) so the viewer can size LEDs by spacing, not by rig extent.
  const pitches = instances.map((inst) => inst.fixture.meta?.pitchMM).filter((p) => p > 0);

  return buildScene({
    name,
    units,
    pixels,
    meta: {
      ...meta,
      pitchMM: pitches.length ? Math.min(...pitches) : undefined,
      instances: instances.map((inst) => ({
        name: inst.name,
        fixture: inst.fixtureName,
        pos: inst.pos || [0, 0, 0],
        rotDeg: inst.rotDeg || [0, 0, 0],
        ...(inst.output ? { output: inst.output } : {}),
      })),
    },
  });
}

// Turn a parsed YAML layout doc into a { scene, show } using registries:
//   fixtures: { [type]: (params) => ({ pixels, meta }) }   — how to build each fixture's geometry
//   patterns: { [name]: (params) => (px,t,ctx) => [r,g,b] } — for the optional `show:` block
//
// Layout doc shape:
//   name, units
//   fixtures: { <fixtureName>: { type, params } }
//   instances: [ { fixture: <fixtureName>, name, pos:[x,y,z], rotDeg:[rx,ry,rz] } ]
//   show: { holdS, fadeS, scenes: [ { name, pattern, params } ] }   (optional)
export function resolveLayout(doc, { fixtures = {}, patterns = {} } = {}) {
  const fixDefs = doc.fixtures || {};
  const cache = {};
  const getFixture = (fixtureName) => {
    if (cache[fixtureName]) return cache[fixtureName];
    const def = fixDefs[fixtureName];
    if (!def) throw new Error(`layout references undefined fixture "${fixtureName}"`);
    const make = fixtures[def.type];
    if (!make) throw new Error(`unknown fixture type "${def.type}" (registered: ${Object.keys(fixtures).join(", ") || "none"})`);
    return (cache[fixtureName] = make(def.params || {}));
  };

  const instances = (doc.instances || []).map((inst, k) => {
    if (!inst.fixture) throw new Error(`instance #${k} is missing a "fixture"`);
    const def = fixDefs[inst.fixture] || {};
    // The output patch merges the fixture-level default with per-instance overrides.
    const output = def.output || inst.output ? { ...(def.output || {}), ...(inst.output || {}) } : undefined;
    return {
      name: inst.name || `${inst.fixture}-${k + 1}`,
      fixtureName: inst.fixture,
      fixture: getFixture(inst.fixture),
      pos: inst.pos,
      rotDeg: inst.rotDeg,
      output,
    };
  });
  if (!instances.length) throw new Error("layout has no instances");

  const scene = buildSceneFromLayout({
    name: doc.name || "layout",
    units: doc.units || "mm",
    instances,
    meta: { fixtureTypes: Object.fromEntries(Object.entries(fixDefs).map(([k, v]) => [k, v.type])) },
  });

  let show = null;
  if (doc.show) {
    const scenes = (doc.show.scenes || []).map((sc, k) => {
      const make = patterns[sc.pattern];
      if (!make) throw new Error(`scene #${k} uses unknown pattern "${sc.pattern}" (have: ${Object.keys(patterns).join(", ")})`);
      return { name: sc.name || sc.pattern, render: make(sc.params || {}) };
    });
    show = { scenes, holdS: doc.show.holdS ?? 4, fadeS: doc.show.fadeS ?? 2.5 };
  }

  return { scene, show };
}
