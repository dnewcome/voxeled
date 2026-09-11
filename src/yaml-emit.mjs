// YAML emitter for voxeled layout files — the writing half of src/yaml.mjs (the parser). Emits the
// same subset the parser reads: block maps / sequences, inline `[…]` / `{…}` flow for short values,
// typed scalars. Used by the builder to write a layout back after editing it in the viewer.
// Comments can't survive a round trip through the object model; the file's leading comment block
// (the header) is preserved when you pass it in.

const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

function scalar(v) {
  if (v === null || v === undefined) return "~";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "~";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  // bare when it can't be mistaken for a number/bool/null or YAML syntax; otherwise JSON-quote
  const bare = /^[A-Za-z_][A-Za-z0-9_ .·()/\\+-]*$/.test(s) && !/[:#\[\]{},]/.test(s) && !/^(true|false|null|~)$/i.test(s) && s.trim() === s;
  return bare ? s : JSON.stringify(s);
}

const inlineArray = (a) => `[${a.map(scalar).join(", ")}]`;
function inlineMap(o) {
  return `{ ${Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? inlineArray(v) : isScalar(v) ? scalar(v) : inlineMap(v)}`).join(", ")} }`;
}
// a value is "short" if it can be written inline in one readable line
function isShort(v, depth = 0) {
  if (isScalar(v)) return true;
  if (Array.isArray(v)) return v.every(isScalar) && inlineArray(v).length < 80;
  if (depth > 1) return false;
  if (!Object.keys(v).length) return true;
  return Object.values(v).every((x) => isScalar(x) || (Array.isArray(x) && x.every(isScalar)) || (typeof x === "object" && isShort(x, depth + 1))) && inlineMap(v).length < 100;
}

function emit(v, indent, lines) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(v)) {
    for (const item of v) {
      if (isScalar(item)) lines.push(`${pad}- ${scalar(item)}`);
      else if (Array.isArray(item)) lines.push(`${pad}- ${inlineArray(item)}`);
      else if (isShort(item)) lines.push(`${pad}- ${inlineMap(item)}`);
      else {
        // block map under the dash: first key on the dash line, the rest indented to align
        const entries = Object.entries(item);
        entries.forEach(([k, val], i) => {
          const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
          emitEntry(k, val, prefix, indent + 1, lines);
        });
      }
    }
  } else {
    for (const [k, val] of Object.entries(v)) emitEntry(k, val, pad, indent, lines);
  }
}
function emitEntry(k, val, prefix, indent, lines) {
  if (isScalar(val)) lines.push(`${prefix}${k}: ${scalar(val)}`);
  else if (Array.isArray(val) && isShort(val)) lines.push(`${prefix}${k}: ${inlineArray(val)}`);
  else if (!Array.isArray(val) && isShort(val)) lines.push(`${prefix}${k}: ${Object.keys(val).length ? inlineMap(val) : "{}"}`);
  else if (Array.isArray(val) && !val.length) lines.push(`${prefix}${k}: []`);
  else { lines.push(`${prefix}${k}:`); emit(val, indent + 1, lines); }
}

export function stringifyYAML(doc, { header = "" } = {}) {
  const lines = [];
  emit(doc, 0, lines);
  const head = header ? header.replace(/\s+$/, "") + "\n\n" : "";
  return head + lines.join("\n") + "\n";
}

// The leading comment block of a YAML file (so a rewrite keeps the file's own preamble).
export function yamlHeader(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) { if (/^\s*#/.test(line) || line.trim() === "") { if (out.length || line.trim()) out.push(line); } else break; }
  return out.join("\n").trim();
}
