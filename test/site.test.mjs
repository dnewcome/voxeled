// Site context: the geo-anchor math, vantage resolution + routes, the Street View URL builder, and
// a headless-Chrome check that standing at a vantage really shows the backdrop at the right
// compass bearing (a compass test panorama: north red, east green, south blue, west yellow) — for
// both an equirectangular image and a n/e/s/w/u/d cubemap — with the LEDs drawn over it.
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bearingToLocal, geoToLocal, localToGeo, resolveVantages, resolveSite, vantageRoutes } from "../src/site.mjs";
import { streetviewUrls, fetchStreetView } from "../src/io/streetview.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { parseYAML } from "../src/yaml.mjs";
import { FIXTURES } from "../examples/mobius-heart/fixtures.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { compassPanorama, faceImage, decodePNG, COMPASS } from "./helpers/png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── compass math ──────────────────────────────────────────────────────────────
let d = bearingToLocal(0, 0); ok(near(d[0], 0) && near(d[2], -1), "bearing 0 (north) with heading 0 is local −Z");
d = bearingToLocal(90, 0); ok(near(d[0], 1) && near(d[2], 0), "bearing 90 (east) is local +X");
d = bearingToLocal(90, 90); ok(near(d[0], 0) && near(d[2], -1), "with the piece heading 90, east is the piece's −Z");
const site = resolveSite({ lat: 37.7749, lon: -122.4194, headingDeg: 30 });
const g = localToGeo([1000, 0, -2000], site), back = geoToLocal(g, site);
ok(near(back[0], 1000, 1e-3) && near(back[1], -2000, 1e-3), "local → geo → local round-trips (1 m east, 2 m ahead, heading 30°)");
const north100 = geoToLocal({ lat: site.lat + 100 / 111195, lon: site.lon }, { ...site, headingDeg: 0 });
ok(near(north100[0], 0, 5) && near(north100[1], -100000, 50), `100 m north of the anchor is 100 m along −Z (${north100.map((x) => x.toFixed(0))})`);

// ── vantage resolution ────────────────────────────────────────────────────────
const dir = mkdtempSync(path.join(tmpdir(), "vox-site-"));
writeFileSync(path.join(dir, "pano.png"), compassPanorama(512, 256, 0));
mkdirSync(path.join(dir, "cube"));
for (const f of ["n", "e", "s", "w"]) writeFileSync(path.join(dir, "cube", `${f}.png`), faceImage(64, COMPASS[f]));
writeFileSync(path.join(dir, "cube", "u.png"), faceImage(64, [255, 255, 255], [255, 0, 0], [0, 255, 0])); // white; red strip on the image's top edge (= south when shot facing north at pitch 90), green on its left (= west)
writeFileSync(path.join(dir, "cube", "d.png"), faceImage(64, [40, 40, 40], [255, 0, 0], [0, 255, 0]));    // dark; red on top (= north when shot facing north at pitch −90), green on the left (= west)
const vs = resolveVantages([
  { name: "south-of-it", lat: site.lat - 20 / 111195, lon: site.lon, eyeHeightMM: 1600, image: "pano.png" },
  { name: "here", pos: [0, 1500, 8000], cube: "cube", headingDeg: 0, fovDeg: 70 },
], { baseDir: dir, site: { ...site, headingDeg: 0 } });
ok(vs[0].pos[1] === 1600 && near(vs[0].pos[2], 20000, 50) && near(vs[0].pos[0], 0, 5), `a lat/lon vantage 20 m south lands at z≈+20 m, eye 1.6 m (${vs[0].pos})`);
ok(vs[0].image.format === "png" && vs[1].cube.n.file.endsWith("n.png") && vs[1].fovDeg === 70, "equirect image and cube faces resolve relative to the layout");
let threw = ""; try { resolveVantages([{ name: "x", lat: 1, lon: 2, image: "pano.png" }], { baseDir: dir }); } catch (e) { threw = e.message; }
ok(/no `site` anchor/.test(threw), "a lat/lon vantage without a site anchor is a clear error");
threw = ""; try { resolveVantages([{ name: "x", pos: [0, 0, 0], cube: "nope" }], { baseDir: dir }); } catch (e) { threw = e.message; }
ok(/missing faces/.test(threw), "a cube dir missing faces is a clear error");
const routes = vantageRoutes({ meta: { vantages: vs } });
ok(routes.length === 7 && vs[0].image.url === "vantage/0.png" && vs[1].cube.u.url === "vantage/1/u.png", "routes: one per image, six per cube; urls stamped");

// ── through the layout ────────────────────────────────────────────────────────
const layoutText = `name: site-test
site: { lat: ${site.lat}, lon: ${site.lon}, headingDeg: 0 }
fixtures:
  heart: { type: mobius-heart, params: { panelsPerSide: 4, pitchMM: 10, twist: mobius } }
instances:
  - { fixture: heart, name: h, pos: [0, 800, 0], rotDeg: [0, 180, 0] }
vantages:
  - { name: south-of-it, lat: ${site.lat - 6 / 111195}, lon: ${site.lon}, eyeHeightMM: 900, image: pano.png }
  - { name: here, pos: [0, 900, 6000], cube: cube }
`;
const layoutFile = path.join(dir, "site.yaml");
writeFileSync(layoutFile, layoutText);
const { scene } = resolveLayout(parseYAML(layoutText), { fixtures: FIXTURES, patterns: PATTERNS, baseDir: dir });
ok(scene.meta.site.lat === site.lat && scene.meta.vantages.length === 2 && scene.meta.vantages[0].image, "resolveLayout carries site + vantages into scene.meta");

// ── Street View fetcher (URL builder + a mocked fetch) ─────────────────────────
const u = streetviewUrls({ lat: 1.5, lon: -2.25, key: "K" });
ok(u.faces.n.includes("heading=0&pitch=0&fov=90") && u.faces.u.includes("pitch=90") && u.faces.d.includes("pitch=-90") && u.faces.w.includes("heading=270") && u.meta.includes("/metadata?location=1.5,-2.25"), "six compass-aligned 90° faces + a metadata URL");
const calls = [];
const fakeFetch = async (url) => { calls.push(url); if (url.includes("/metadata")) return { json: async () => ({ status: "OK", pano_id: "PANO1", location: { lat: 1.5001, lng: -2.2501 }, date: "2024-05" }) }; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
const info = await fetchStreetView({ lat: 1.5, lon: -2.25, key: "K", outDir: path.join(dir, "sv"), fetchImpl: fakeFetch });
ok(info.panoId === "PANO1" && info.lat === 1.5001 && calls.length === 7 && calls.slice(1).every((c) => c.includes("pano=PANO1")) && existsSync(path.join(dir, "sv/d.jpg")) && existsSync(path.join(dir, "sv/vantage.json")), "fetch: metadata first, then six faces by pano id, files + vantage.json written");
threw = ""; try { await fetchStreetView({ lat: 0, lon: 0, key: "", outDir: dir }); } catch (e) { threw = e.message; }
ok(/GOOGLE_MAPS_API_KEY/.test(threw), "no key → says which env var to set");

// ── headless render: stand at each vantage, check the backdrop's compass colour at the centre ────
const chrome = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", process.env.CHROME_BIN].filter(Boolean).find((b) => spawnSync("which", [b]).status === 0 || (b.includes("/") && existsSync(b)));
if (!chrome) console.log("  ⊘ SKIP render check — no Chrome found");
else {
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const server = spawn("node", ["examples/mobius-heart/run.mjs", layoutFile], { cwd: ROOT, env: { ...process.env, PORT: String(port), VOX_NO_QR: "1" }, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { await fetch(`http://localhost:${port}/scene.json`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  ok(up, "hub started with the site layout");
  const art = path.join(ROOT, "test/artifacts"); mkdirSync(art, { recursive: true });
  const shot = async (name, query) => {
    const file = path.join(art, `site-${name}.png`);
    const r = spawnSync(chrome, ["--headless=new", "--no-sandbox", `--user-data-dir=${path.join(art, "chrome-profile")}`, "--no-first-run", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=800,500", "--virtual-time-budget=8000", "--enable-logging=stderr", "--v=1", `--screenshot=${file}`, `http://localhost:${port}/?${query}`], { encoding: "utf8", timeout: 40000 });
    const log = (r.stdout || "") + (r.stderr || "");
    return { log, png: existsSync(file) ? decodePNG(readFileSync(file)) : null };
  };
  const centre = (png) => png.at(png.width >> 1, png.height >> 1);
  const isColor = (c, want, tol = 60) => c && Math.abs(c[0] - want[0]) < tol && Math.abs(c[1] - want[1]) < tol && Math.abs(c[2] - want[2]) < tol;
  // equirect vantage: look north (red), east (green), then at the piece: LEDs drawn over the photo
  let r = await shot("equirect-n", "stand=south-of-it&bearing=0&pitch=0");
  ok(r.log.includes("VOXELED_STAND_READY south-of-it"), "standing at the equirect vantage (backdrop loaded)");
  ok(!r.log.includes("VOXELED_ERROR") && !r.log.includes("VOXELED_VANTAGE_FAILED"), "no viewer error");
  ok(r.png && isColor(centre(r.png), COMPASS.n), `equirect: looking north shows the north band (centre ${centre(r.png)})`);
  r = await shot("equirect-e", "stand=south-of-it&bearing=90&pitch=0");
  ok(r.png && isColor(centre(r.png), COMPASS.e), `equirect: looking east shows the east band (centre ${centre(r.png)})`);
  r = await shot("equirect-w-up", "stand=south-of-it&bearing=270&pitch=40");
  ok(r.png && isColor(centre(r.png), COMPASS.w.map((x) => x * 0.35), 40), `equirect: west + up shows the darker west sky (centre ${centre(r.png)})`);
  // cube vantage
  r = await shot("cube-n", "stand=here&bearing=0&pitch=0");
  ok(r.log.includes("VOXELED_STAND_READY here"), "standing at the cube vantage");
  ok(r.png && isColor(centre(r.png), COMPASS.n), `cube: north face ahead when looking north (centre ${centre(r.png)})`);
  r = await shot("cube-e", "stand=here&bearing=90&pitch=0");
  ok(r.png && isColor(centre(r.png), COMPASS.e), `cube: east face when looking east (centre ${centre(r.png)})`);
  r = await shot("cube-s", "stand=here&bearing=180&pitch=0");
  ok(r.png && isColor(centre(r.png), COMPASS.s), `cube: south face when looking south (centre ${centre(r.png)})`);
  // the seam between faces must line up: looking north-east the left half is red, the right half green
  r = await shot("cube-ne", "stand=here&bearing=45&pitch=0&fov=90");
  const l = r.png?.at((r.png.width * 0.4) | 0, (r.png.height * 0.45) | 0), rt = r.png?.at((r.png.width * 0.6) | 0, (r.png.height * 0.45) | 0); // clear of the HUD and the piece
  ok(isColor(l, COMPASS.n) && isColor(rt, COMPASS.e), `cube: faces aren't mirrored — north on the left, east on the right at bearing 45 (${l} | ${rt})`);
  // up face orientation: shot facing north at pitch 90, its top edge is SOUTH
  r = await shot("cube-up-s", "stand=here&bearing=180&pitch=50&fov=30");
  const upS = centre(r.png);
  r = await shot("cube-up-n", "stand=here&bearing=0&pitch=50&fov=30");
  const upN = centre(r.png);
  ok(isColor(upS, [255, 0, 0]) && isColor(upN, [255, 255, 255]), `cube: up face oriented — its top edge (red strip) lies to the south (S ${upS} · N ${upN})`);
  r = await shot("cube-up-w", "stand=here&bearing=270&pitch=50&fov=30");
  const upW = centre(r.png);
  r = await shot("cube-up-e", "stand=here&bearing=90&pitch=50&fov=30");
  const upE = centre(r.png);
  ok(isColor(upW, [0, 255, 0]) && isColor(upE, [255, 255, 255]), `cube: up face handedness — its left edge (green) lies to the west (W ${upW} · E ${upE})`);
  r = await shot("cube-down-n", "stand=here&bearing=0&pitch=-50&fov=30");
  const dnN = centre(r.png);
  r = await shot("cube-down-s", "stand=here&bearing=180&pitch=-50&fov=30");
  const dnS = centre(r.png);
  ok(isColor(dnN, [255, 0, 0]) && isColor(dnS, [40, 40, 40]), `cube: down face oriented — its top edge lies to the north (N ${dnN} · S ${dnS})`);
  r = await shot("cube-down-w", "stand=here&bearing=270&pitch=-50&fov=30");
  const dnW = centre(r.png);
  r = await shot("cube-down-e", "stand=here&bearing=90&pitch=-50&fov=30");
  const dnE = centre(r.png);
  ok(isColor(dnW, [0, 255, 0]) && isColor(dnE, [40, 40, 40]), `cube: down face handedness — its left edge (green) lies to the west (W ${dnW} · E ${dnE})`);
  // the piece: from 'here' (6 m south of the heart, facing north) the heart's LEDs should be drawn over the red band
  r = await shot("piece", "stand=here&bearing=0&pitch=0&fov=30");
  let leds = 0; if (r.png) for (let y = 0; y < r.png.height; y += 2) for (let x = 0; x < r.png.width; x += 2) { const c = r.png.at(x, y); if (!(c[0] > 180 && c[1] < 60 && c[2] < 60) && !(c[0] < 30 && c[1] < 30 && c[2] < 30)) leds++; }
  ok(leds > 200, `the piece is drawn over the backdrop (${leds} non-backdrop samples)`);
  ok(r.log.includes("VOXELED_READY"), "viewer built its geometry while standing");
  try { server.kill("SIGTERM"); } catch {}
}

console.log(`\n${fail === 0 ? "✅" : "❌"} site: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
