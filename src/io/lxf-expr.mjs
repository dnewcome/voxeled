// A tiny, safe expression evaluator for LX `.lxf` fixture templates.
//
// LX fixture fields are strings of arithmetic over `$parameters` (and `$instance` inside a repeated
// component): e.g. "-0.5 * ($size + 2*$padding)", "$padding * cos($degrees/($numStrips-1)*$instance)".
// Grammar: numbers, $vars, + - * / %, unary ±, parens, and function calls. NO `eval()` — a hand
// parser, so a malicious .lxf can't run code.
//
// TRIG IS IN DEGREES. The decisive case is Fan.lxf: it spans `$degrees` (e.g. 180) and places strips
// with cos()/sin() of that angle — only degrees produce a fan, radians produce noise.

function tokenize(s) {
  const toks = [];
  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "$") {
      let j = i + 1;
      while (j < s.length && (isAlpha(s[j]) || isDigit(s[j]))) j++;
      toks.push({ t: "var", v: s.slice(i + 1, j) }); i = j; continue;
    }
    if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      let j = i;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j++;
      toks.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < s.length && (isAlpha(s[j]) || isDigit(s[j]))) j++;
      toks.push({ t: "name", v: s.slice(i, j) }); i = j; continue;
    }
    if ("+-*/%(),".includes(c)) { toks.push({ t: c }); i++; continue; }
    throw new Error(`lxf-expr: unexpected char '${c}' in "${s}"`);
  }
  return toks;
}

// recursive-descent → AST (cached per source string; strings recur across component instances)
function parse(str) {
  const toks = tokenize(str);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t, ctx) => { const k = next(); if (!k || k.t !== t) throw new Error(`lxf-expr: expected '${t}' ${ctx} in "${str}"`); };

  const expr = () => add();
  const add = () => { let n = mul(); while (peek() && (peek().t === "+" || peek().t === "-")) { const op = next().t; n = { t: "bin", op, l: n, r: mul() }; } return n; };
  const mul = () => { let n = un(); while (peek() && (peek().t === "*" || peek().t === "/" || peek().t === "%")) { const op = next().t; n = { t: "bin", op, l: n, r: un() }; } return n; };
  const un = () => { if (peek() && (peek().t === "-" || peek().t === "+")) { const op = next().t; return { t: "un", op, e: un() }; } return prim(); };
  const prim = () => {
    const k = next();
    if (!k) throw new Error(`lxf-expr: unexpected end of "${str}"`);
    if (k.t === "num") return { t: "num", v: k.v };
    if (k.t === "var") return { t: "var", v: k.v };
    if (k.t === "(") { const e = expr(); expect(")", "to close ("); return e; }
    if (k.t === "name") {
      if (peek() && peek().t === "(") {
        next();
        const args = [];
        if (peek() && peek().t !== ")") { args.push(expr()); while (peek() && peek().t === ",") { next(); args.push(expr()); } }
        expect(")", `after ${k.v}(`);
        return { t: "call", name: k.v, args };
      }
      return { t: "const", name: k.v };
    }
    throw new Error(`lxf-expr: unexpected token '${k.t}' in "${str}"`);
  };

  const ast = expr();
  if (i < toks.length) throw new Error(`lxf-expr: trailing tokens in "${str}"`);
  return ast;
}

const D = Math.PI / 180;
const FUNCS = {
  sin: (a) => Math.sin(a * D), cos: (a) => Math.cos(a * D), tan: (a) => Math.tan(a * D),
  asin: (a) => Math.asin(a) / D, acos: (a) => Math.acos(a) / D, atan: (a) => Math.atan(a) / D,
  atan2: (y, x) => Math.atan2(y, x) / D,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
  exp: Math.exp, log: Math.log, mod: (a, b) => a % b,
};
const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: 2 * Math.PI };

function evAst(n, scope) {
  switch (n.t) {
    case "num": return n.v;
    case "var": {
      const v = scope[n.v];
      if (v === undefined) throw new Error(`lxf-expr: unknown $${n.v}`);
      return typeof v === "boolean" ? (v ? 1 : 0) : v;
    }
    case "const":
      if (n.name in CONSTS) return CONSTS[n.name];
      throw new Error(`lxf-expr: unknown name "${n.name}"`);
    case "un": { const v = evAst(n.e, scope); return n.op === "-" ? -v : v; }
    case "bin": {
      const a = evAst(n.l, scope), b = evAst(n.r, scope);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : a % b;
    }
    case "call": {
      const f = FUNCS[n.name];
      if (!f) throw new Error(`lxf-expr: unknown function "${n.name}()"`);
      return f(...n.args.map((a) => evAst(a, scope)));
    }
  }
}

const CACHE = new Map();

// Evaluate an expression string with a variable scope ({ size: 100, instance: 3, ... }).
export function evalExpr(str, scope = {}) {
  let ast = CACHE.get(str);
  if (!ast) { ast = parse(str); CACHE.set(str, ast); }
  return evAst(ast, scope);
}

// Evaluate a JSON field that may be a number, boolean, or expression string (undefined → default).
export function evalField(v, scope = {}, dflt = 0) {
  if (v === undefined || v === null) return dflt;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return evalExpr(String(v), scope);
}
