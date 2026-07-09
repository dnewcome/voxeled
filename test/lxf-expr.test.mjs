// The .lxf expression evaluator: arithmetic, precedence, $vars/$instance, and DEGREES trig
// (the thing that makes Fan.lxf a fan and not noise). No eval() — a hand parser.
import { evalExpr, evalField } from "../src/io/lxf-expr.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const near = (a, b) => Math.abs(a - b) < 1e-9;

ok(evalExpr("1 + 2 * 3") === 7, "precedence: * before +");
ok(evalExpr("(1 + 2) * 3") === 9, "parentheses");
ok(evalExpr("-2 + 5") === 3, "unary minus");
ok(evalExpr("10 % 3") === 1, "modulo");
ok(evalExpr("$size / $ppe", { size: 100, ppe: 4 }) === 25, "$vars + division");
ok(evalExpr("-0.5 * ($size + 2 * $padding)", { size: 100, padding: 3 }) === -53, "the Cube-centering expression");

ok(near(evalExpr("cos(0)"), 1), "cos(0) = 1");
ok(near(evalExpr("cos(180)"), -1), "TRIG IS DEGREES: cos(180) = -1");
ok(near(evalExpr("sin(90)"), 1), "sin(90) = 1 (degrees)");
ok(near(evalExpr("$r * cos(360 / $n * $instance)", { r: 100, n: 4, instance: 1 }), 0), "$instance in a Fan-style ring expr → cos(90)≈0");
ok(near(evalExpr("sqrt(2)"), Math.SQRT2) && evalExpr("max(3, 7, 5)") === 7, "functions: sqrt, max");

ok(evalField(5) === 5, "evalField: number passthrough");
ok(evalField(true) === 1, "evalField: boolean → 1");
ok(evalField(undefined, {}, 9) === 9, "evalField: undefined → default");
ok(evalField("2 * $k", { k: 21 }) === 42, "evalField: string → evaluated");

const throws = (fn) => { try { fn(); return false; } catch { return true; } };
ok(throws(() => evalExpr("$missing", {})), "unknown $var throws");
ok(throws(() => evalExpr("foo(1)", {})), "unknown function throws");
ok(throws(() => evalExpr("1 +", {})), "syntax error throws");

console.log(`\n${fail === 0 ? "✅" : "❌"} lxf-expr: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
