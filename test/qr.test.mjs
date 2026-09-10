// QR encoder — the phone-page QR must be a REAL, scannable QR code. Structural checks always;
// then a decode gate: render the symbol to PNG and decode it with OpenCV (python3 + cv2), skipped
// cleanly if they're not installed.
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { qrEncode, qrToAscii, qrToSVG } from "../src/qr.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

const url = "http://192.168.1.42:8080/phone.html";
const m = qrEncode(url);
ok(Array.isArray(m) && m.length === m[0].length && (m.length - 21) % 4 === 0, `square matrix of a valid version size (${m.length}×${m.length})`);
const finder = (r, c) => [0, 1, 2, 3, 4, 5, 6].every((i) => m[r][c + i] && m[r + 6][c + i] && m[r + i][c] && m[r + i][c + 6]) && m[r + 3][c + 3];
ok(finder(0, 0) && finder(0, m.length - 7) && finder(m.length - 7, 0), "three finder patterns in the corners");
ok(m.every((row) => row.every((v) => v === 0 || v === 1)), "cells are 0/1");
const dark = m.flat().filter(Boolean).length / (m.length * m.length);
ok(dark > 0.35 && dark < 0.65, `balanced dark ratio after masking (${(100 * dark).toFixed(0)}%)`);
ok(qrToAscii(m).split("\n").length >= m.length / 2 && qrToSVG(m).startsWith("<svg"), "ASCII (half-block) and SVG renderers produce output");
let threw = false; try { qrEncode("x".repeat(400)); } catch { threw = true; }
ok(threw, "too much data for the supported versions throws instead of emitting garbage");

// ── decode gate ───────────────────────────────────────────────────────────────
const py = spawnSync("python3", ["-c", "import cv2, PIL"], { encoding: "utf8" });
if (py.status !== 0) {
  console.log("  ⊘ SKIP decode gate — python3 with cv2 + PIL not available");
} else {
  const tmp = path.join(tmpdir(), `vox-qr-${process.pid}.txt`);
  writeFileSync(tmp, JSON.stringify(m));
  const r = spawnSync("python3", ["-c", `
import json, sys, numpy as np, cv2
from PIL import Image
m = json.load(open(sys.argv[1])); n = len(m); s = 10; q = 4
img = np.full(((n+2*q)*s, (n+2*q)*s), 255, np.uint8)
for r in range(n):
  for c in range(n):
    if m[r][c]: img[(r+q)*s:(r+q+1)*s, (c+q)*s:(c+q+1)*s] = 0
txt, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
print(txt)`, tmp], { encoding: "utf8" });
  unlinkSync(tmp);
  const decoded = (r.stdout || "").trim();
  ok(decoded === url, `OpenCV decodes the symbol back to the URL (got "${decoded || r.stderr.trim().split("\n").pop()}")`);
  // a second, longer payload (version bump) must also decode
  const long = "https://example.com/piece/aa11bb22cc33/phone?token=abcdef0123456789";
  const m2 = qrEncode(long);
  writeFileSync(tmp, JSON.stringify(m2));
  const r2 = spawnSync("python3", ["-c", `
import json, sys, numpy as np, cv2
m = json.load(open(sys.argv[1])); n = len(m); s = 8; q = 4
img = np.full(((n+2*q)*s, (n+2*q)*s), 255, np.uint8)
for r in range(n):
  for c in range(n):
    if m[r][c]: img[(r+q)*s:(r+q+1)*s, (c+q)*s:(c+q+1)*s] = 0
print(cv2.QRCodeDetector().detectAndDecode(img)[0])`, tmp], { encoding: "utf8" });
  unlinkSync(tmp);
  ok((r2.stdout || "").trim() === long, `a longer payload (version ${(m2.length - 17) / 4}) decodes too`);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} qr: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
