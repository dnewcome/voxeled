// Layout (a "rig") — place multiple INSTANCES of a fixture in shared world space.
//
// A fixture is geometry authored once in its own local frame (e.g. one heart). An instance is
// that fixture placed by a world transform (translation in mm + Euler rotation in degrees). This
// is voxeled's version of MVR's model: fixtures + placements. Because instances live in one
// shared world space, a world-space pattern automatically accounts for the real distance between
// them — 2 hearts 10 ft apart really are 10 ft apart to the pattern.
import { add, matVec, eulerMatrix } from "./vec.mjs";
import { buildScene } from "./format.mjs";

// instances: [{ name, pos:[x,y,z]mm, rotDeg:[rx,ry,rz] }]
// fixture:   { pixels:[{ p:[x,y,z], n:[..], s, v }], meta }   (local frame)
export function buildSceneFromLayout({ name, units = "mm", fixture, instances, meta = {} }) {
  const xf = instances.map((inst) => ({
    pos: inst.pos || [0, 0, 0],
    rot: eulerMatrix(inst.rotDeg || [0, 0, 0]),
  }));

  const pixels = [];
  let i = 0;
  xf.forEach((T, k) => {
    for (const lp of fixture.pixels) {
      const p = add(matVec(T.rot, lp.p), T.pos); // world position
      const n = matVec(T.rot, lp.n); // rotate the emission normal (translation doesn't affect it)
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

  return buildScene({
    name,
    units,
    pixels,
    meta: {
      ...meta,
      instances: instances.map((inst) => ({ name: inst.name, pos: inst.pos || [0, 0, 0], rotDeg: inst.rotDeg || [0, 0, 0] })),
      fixture: fixture.meta,
    },
  });
}
