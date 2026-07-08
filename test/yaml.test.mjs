// YAML subset parser (edge cases + the real layout files) and resolveLayout.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYAML } from "../src/yaml.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { sampleHeart } from "../examples/mobius-heart/heart.mjs";
import { PATTERNS } from "../src/patterns.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const doc = parseYAML(`
name: test          # trailing comment
count: 42
neg: -7
pi: 3.14
flag: true
nothing: ~
quoted: "a: b # not a comment"
list: [1, -2, 3.5, foo]
inline: { x: 1, y: -2, space: world }
nested:
  a: 1
  b:
    c: 2
seq:
  - { name: one, v: 1 }
  - fixture: heart
    name: two
    pos: [1, 2, 3]
  - bare
`);
ok(doc.name === "test" && doc.count === 42, "string + int scalars");
ok(doc.neg === -7 && doc.pi === 3.14, "negative int + float");
ok(doc.flag === true && doc.nothing === null, "bool + null (~)");
ok(doc.quoted === "a: b # not a comment", "quoted string keeps ':' and '#'");
ok(eq(doc.list, [1, -2, 3.5, "foo"]), "flow sequence");
ok(eq(doc.inline, { x: 1, y: -2, space: "world" }), "flow mapping");
ok(doc.nested.b.c === 2, "nested block mappings");
ok(eq(doc.seq[0], { name: "one", v: 1 }), "seq item as flow map");
ok(eq(doc.seq[1], { fixture: "heart", name: "two", pos: [1, 2, 3] }), "seq item as multi-line block map");
ok(doc.seq[2] === "bare", "seq item as bare scalar");

const two = parseYAML(readFileSync(`${ROOT}/examples/mobius-heart/layouts/two-hearts.yaml`, "utf8"));
ok(two.fixtures.heart.params.panelsPerSide === 8, "two-hearts.yaml fixture params");
ok(two.instances.length === 2 && eq(two.instances[0].pos, [-1524, 0, 0]), "two-hearts.yaml instances");
ok(two.show.scenes.length === 3 && two.show.scenes[1].params.space === "world", "two-hearts.yaml show");

const facing = parseYAML(readFileSync(`${ROOT}/examples/mobius-heart/layouts/facing-hearts.yaml`, "utf8"));
ok(facing.instances.length === 4 && eq(facing.instances[1].rotDeg, [0, 180, 0]), "facing-hearts.yaml rotation");

const { scene, show } = resolveLayout(two, { fixtures: { "mobius-heart": (p) => sampleHeart(p) }, patterns: PATTERNS });
ok(scene.count === 9216, "resolveLayout: 9216 px");
ok(scene.meta.instances[0].name === "left", "resolveLayout: named instances");
ok(show.scenes.length === 3 && typeof show.scenes[0].render === "function", "resolveLayout: renderable scenes");

let threw = false;
try { resolveLayout({ instances: [{ fixture: "ghost" }] }, { fixtures: {} }); } catch { threw = true; }
ok(threw, "undefined fixture reference throws");

console.log(`yaml: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
