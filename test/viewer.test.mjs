// Headless-Chrome render gate — the check that would have caught "I don't see the pixels".
// Boots the real demo server, loads the viewer in headless Chrome, and asserts the page built
// its geometry (the VOXELED_READY console signal) with no VOXELED_ERROR. Also a static check
// that the viewer is fully offline (no CDN URLs). Skips cleanly if Chrome isn't installed.
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync, existsSync } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

// Static: the viewer must not reference any CDN — proves it runs offline.
const html = readFileSync(path.join(ROOT, "viewer/index.html"), "utf8");
ok(!/unpkg|cdn|https?:\/\/[^"']*\.js/i.test(html), "viewer references no external CDN (offline)");
ok(existsSync(path.join(ROOT, "viewer/vendor/three.module.js")), "three.js is vendored locally");

// Find a Chrome binary; skip the render gate if none.
const chrome = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", process.env.CHROME_BIN]
  .filter(Boolean)
  .find((b) => spawnSync("which", [b]).status === 0 || (b.includes("/") && existsSync(b)));
if (!chrome) {
  console.log("  ⊘ SKIP render gate — no Chrome found (set CHROME_BIN to enable)");
  console.log(`viewer: ${pass} passed, ${fail} failed (render gate skipped)`);
  process.exit(fail === 0 ? 0 : 1);
}

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();

const server = spawn("node", ["examples/mobius-heart/run.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const done = (code) => { try { server.kill("SIGTERM"); } catch {} process.exit(code); };

// Wait for the server.
let up = false;
for (let i = 0; i < 80; i++) {
  try { await fetch(`http://localhost:${port}/scene.json`); up = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
ok(up, "demo server started");
if (!up) done(1);

// Load the viewer in headless Chrome, capture console + a screenshot.
const artDir = path.join(ROOT, "test/artifacts");
mkdirSync(artDir, { recursive: true });
const shot = path.join(artDir, "viewer.png");
const profile = path.join(artDir, "chrome-profile");
const r = spawnSync(chrome, [
  "--headless=new", "--no-sandbox", `--user-data-dir=${profile}`, "--no-first-run",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,800", "--virtual-time-budget=8000",
  "--enable-logging=stderr", "--v=1", `--screenshot=${shot}`,
  `http://localhost:${port}/`,
], { encoding: "utf8", timeout: 40000 });

const out = (r.stdout || "") + (r.stderr || "");
ok(out.includes("VOXELED_READY"), "viewer built its geometry (VOXELED_READY fired)");
ok(!out.includes("VOXELED_ERROR"), "viewer boot threw no error");
ok(!/Failed to resolve module|net::ERR|Uncaught (Syntax|Reference|Type)Error/.test(out), "no module-resolution / load errors");
ok(existsSync(shot), `screenshot saved → ${path.relative(ROOT, shot)}`);

console.log(`viewer: ${pass} passed, ${fail} failed`);
done(fail === 0 ? 0 : 1);
