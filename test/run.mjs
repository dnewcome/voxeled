// Test runner — executes every *.test.mjs in this directory (sequentially, since some bind
// ports) and aggregates. Each suite exits non-zero on failure. Run with `npm test`.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith(".test.mjs")).sort();

let failed = 0;
for (const f of files) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync("node", [path.join(DIR, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(`  ✗ ${f} FAILED (exit ${r.status})`); }
}

console.log(`\n${failed === 0 ? `✅ ALL ${files.length} SUITES PASS` : `❌ ${failed}/${files.length} SUITE(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
