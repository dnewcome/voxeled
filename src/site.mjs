// Site context — put the piece IN THE WORLD and stand where the audience will stand.
//
// Two layout blocks:
//   site: { lat, lon, headingDeg, groundMM }   the GEO-ANCHOR: voxeled's origin sits at (lat, lon) and
//                                             the piece's −Z axis points at compass bearing headingDeg
//                                             (0 = north, 90 = east). Everything stays in mm.
//   vantages: [ { name, lat, lon | pos, eyeHeightMM, headingDeg, image | cube, fovDeg } ]
//                                             places a viewer can stand, each with a 360° backdrop:
//                                             `image` = an equirectangular photo whose centre column
//                                             faces headingDeg; `cube` = a directory of compass-aligned
//                                             faces n/e/s/w/u/d.<ext> (what `vox streetview` fetches).
// The viewer (V) puts the camera at the vantage's eye, wraps the photo around it, and renders the
// LEDs / structures / simulator on top — so you see the piece from that spot, at the right size and
// bearing. A Street View cubemap is one source; a night 360° shot from your phone is a better one.
import path from "node:path";
import { existsSync } from "node:fs";

const R_EARTH = 6371000; // m
const D2R = Math.PI / 180;

// Compass bearing (deg clockwise from north) → unit direction in the piece's local frame (Y up).
// With site.headingDeg = H, local −Z has bearing H, so bearing B = −Z rotated about Y by (H − B).
export function bearingToLocal(bearingDeg, headingDeg = 0) {
  const t = (headingDeg - bearingDeg) * D2R;
  return [-Math.sin(t), 0, -Math.cos(t)];
}

// lat/lon → local mm (x, z) on the flat-earth tangent plane at the anchor (fine for a site).
export function geoToLocal({ lat, lon }, site) {
  const east = (lon - site.lon) * D2R * R_EARTH * Math.cos(site.lat * D2R) * 1000;
  const north = (lat - site.lat) * D2R * R_EARTH * 1000;
  const H = (site.headingDeg || 0) * D2R;
  // local north = bearingToLocal(0), local east = bearingToLocal(90)
  const nd = bearingToLocal(0, site.headingDeg || 0), ed = bearingToLocal(90, site.headingDeg || 0);
  return [east * ed[0] + north * nd[0], east * ed[2] + north * nd[2]];
}

export function localToGeo([x, , z], site) {
  const nd = bearingToLocal(0, site.headingDeg || 0), ed = bearingToLocal(90, site.headingDeg || 0);
  const north = x * nd[0] + z * nd[2], east = x * ed[0] + z * ed[2]; // project onto the compass axes
  return {
    lat: site.lat + north / 1000 / R_EARTH / D2R,
    lon: site.lon + east / 1000 / (R_EARTH * Math.cos(site.lat * D2R)) / D2R,
  };
}

const IMG = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ext = (f) => (String(f).match(/\.(\w+)$/)?.[1] || "").toLowerCase();
export const CUBE_FACES = ["n", "e", "s", "w", "u", "d"];

export function resolveSite(site) {
  if (!site) return undefined;
  if (typeof site.lat !== "number" || typeof site.lon !== "number") throw new Error("site needs numeric `lat` and `lon`");
  return { lat: site.lat, lon: site.lon, headingDeg: site.headingDeg || 0, groundMM: site.groundMM || 0 };
}

export function resolveVantages(list, { baseDir, site } = {}) {
  return (list || []).map((v, i) => {
    const name = v.name || `vantage-${i}`;
    let pos;
    if (v.pos) pos = v.pos;
    else if (typeof v.lat === "number" && typeof v.lon === "number") {
      if (!site) throw new Error(`vantage "${name}" uses lat/lon but the layout has no \`site\` anchor`);
      const [x, z] = geoToLocal(v, site);
      pos = [x, (site.groundMM || 0) + (v.eyeHeightMM ?? 1600), z];
    } else throw new Error(`vantage "${name}" needs \`pos\` [x,y,z] mm or \`lat\`/\`lon\``);
    const out = { name, pos: pos.map((x) => +x.toFixed(1)), headingDeg: v.headingDeg || 0, fovDeg: v.fovDeg || 60, ...(v.lat != null ? { lat: v.lat, lon: v.lon } : {}) };
    const dir = baseDir || process.cwd();
    if (v.image) {
      const file = path.resolve(dir, v.image);
      if (!IMG[ext(file)]) throw new Error(`vantage "${name}": image must be jpg/png/webp`);
      out.image = { file, format: ext(file) };
    } else if (v.cube) {
      const cdir = path.resolve(dir, v.cube);
      const found = CUBE_FACES.map((f) => ["jpg", "jpeg", "png", "webp"].map((e) => path.join(cdir, `${f}.${e}`)).find(existsSync));
      const missing = CUBE_FACES.filter((_, k) => !found[k]);
      if (missing.length) throw new Error(`vantage "${name}": cube dir ${v.cube} is missing faces ${missing.join(", ")} (need n e s w u d .jpg/.png)`);
      out.cube = Object.fromEntries(CUBE_FACES.map((f, k) => [f, { file: found[k], format: ext(found[k]) }]));
    } else throw new Error(`vantage "${name}" needs an \`image\` (equirectangular) or a \`cube\` directory`);
    return out;
  });
}

// Serve each vantage's imagery at /vantage/<i>.<ext> or /vantage/<i>/<face>.<ext>; stamps `url`s.
export function vantageRoutes(scene) {
  const routes = [];
  (scene.meta?.vantages || []).forEach((v, i) => {
    if (v.image) { v.image.url = `vantage/${i}.${v.image.format}`; routes.push({ path: "/" + v.image.url, file: v.image.file, contentType: IMG[v.image.format] }); }
    if (v.cube) for (const f of CUBE_FACES) { const c = v.cube[f]; c.url = `vantage/${i}/${f}.${c.format}`; routes.push({ path: "/" + c.url, file: c.file, contentType: IMG[c.format] }); }
  });
  return routes;
}
