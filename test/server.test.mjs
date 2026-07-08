// Server wiring: serves scene.json (rig + show meta) and the /control endpoint mutates control.
import http from "node:http";
import { generateScene } from "../examples/mobius-heart/map.mjs";
import { createBus } from "../src/bus.mjs";
import { createShow } from "../src/mixer.mjs";
import { PATTERNS } from "../src/patterns.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const safety = setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 8000);

const scene = generateScene({ hearts: 2, spacingFt: 10 });
const scenes = [{ name: "chase", render: PATTERNS.ribbonChase() }, { name: "across", render: PATTERNS.worldWipe({ space: "world" }) }];
const control = { mode: "auto", fader: 0, a: 0, b: 1 };
createShow({ scenes, control });
scene.meta.show = { scenes: scenes.map((s) => s.name) };

const controlHandler = (req, res, params) => {
  if (params.has("mode")) control.mode = params.get("mode") === "manual" ? "manual" : "auto";
  if (params.has("fader")) control.fader = Math.max(0, Math.min(1, +params.get("fader")));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(control));
};

const bus = createBus({
  port: 0,
  routes: [
    { path: "/scene.json", content: JSON.stringify(scene), contentType: "application/json" },
    { path: "/control", handler: controlHandler },
  ],
});
await new Promise((r) => (bus.server.listening ? r() : bus.server.once("listening", r)));
const port = bus.server.address().port;
const get = (p) => new Promise((resolve) => http.get({ port, path: p }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d })); }));

const sj = await get("/scene.json");
const j = JSON.parse(sj.body);
ok(sj.status === 200 && j.count === 9216, "scene.json: 200, 9216 px");
ok(j.meta.instances.length === 2 && Array.isArray(j.meta.show?.scenes), "meta has 2 instances + show scenes");
await get("/control?mode=manual&fader=0.5");
ok(control.mode === "manual" && control.fader === 0.5, "/control mutated fader");
await get("/control?mode=auto");
ok(control.mode === "auto", "/control resets to auto");

bus.close();
clearTimeout(safety);
console.log(`server: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
