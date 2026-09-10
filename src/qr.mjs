// A dependency-free QR encoder (ISO/IEC 18004): byte mode, error-correction level M, versions
// 1–9 (up to 181 bytes — any LAN or hosted URL). Used to put a scannable code for the phone
// control page in the terminal / on a page. Verified by decoding with OpenCV in test/qr.test.mjs.
//
// Reed–Solomon block table + alignment positions transcribed from the MIT qrcode-generator
// (Kazuhiko Arase); everything else is the standard algorithm.

// per version (index v−1), EC level M: [blocks, totalCodewords, dataCodewords, (blocks2, total2, data2)]
const RS_M = [
  [1, 26, 16], [1, 44, 28], [1, 70, 44], [2, 50, 32], [2, 67, 43], [4, 43, 27], [4, 49, 31],
  [2, 60, 38, 2, 61, 39], [3, 58, 36, 2, 59, 37],
];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];
const EC_M_BITS = 0b00;

// ── GF(256) + Reed–Solomon ──────────────────────────────────────────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}
function rsEncode(data, n) {
  const g = rsGenerator(n);
  const res = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ res[0];
    res.shift(); res.push(0);
    if (f) for (let j = 0; j < n; j++) res[j] ^= gmul(g[j + 1], f);
  }
  return res;
}

// ── BCH for format (15 bit) and version (18 bit) info ───────────────────────
function formatBits(mask) {
  const data = (EC_M_BITS << 3) | mask;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10);
  return ((data << 10) | d) ^ 0x5412;
}
function versionBits(v) {
  let d = v << 12;
  for (let i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= 0x1f25 << (i - 12);
  return (v << 12) | d;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// Encode text → matrix of 0/1 (rows). Throws if it doesn't fit version 9.
export function qrEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let v = 0, spec = null;
  for (let i = 0; i < RS_M.length; i++) {
    const s = RS_M[i], dataCW = s[0] * s[2] + (s[3] ? s[3] * s[5] : 0);
    if (bytes.length <= dataCW - 2) { v = i + 1; spec = s; break; } // 4 mode + 8 count bits
  }
  if (!v) throw new Error(`QR: ${bytes.length} bytes exceeds version-9 capacity (181)`);
  const dataCW = spec[0] * spec[2] + (spec[3] ? spec[3] * spec[5] : 0);

  // data bit stream: mode 0100, 8-bit count, bytes, terminator, byte-align, pad codewords
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, 8);
  for (const x of bytes) push(x, 8);
  for (let i = 0; i < 4 && bits.length < dataCW * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; cw.push(x); }
  for (let p = 0; cw.length < dataCW; p++) cw.push(p % 2 ? 0x11 : 0xec);

  // blocks + EC, then interleave
  const groups = [[spec[0], spec[1], spec[2]]];
  if (spec[3]) groups.push([spec[3], spec[4], spec[5]]);
  const blocks = [];
  let off = 0;
  for (const [nb, tot, dc] of groups) for (let b = 0; b < nb; b++) { const d = cw.slice(off, off + dc); off += dc; blocks.push({ d, e: rsEncode(d, tot - dc) }); }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length)), maxE = Math.max(...blocks.map((b) => b.e.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < maxE; i++) for (const b of blocks) if (i < b.e.length) out.push(b.e[i]);
  return placeAndMask(v, out);
}

function placeAndMask(v, codewords) {
  const N = 17 + 4 * v;
  const M = Array.from({ length: N }, () => new Array(N).fill(0));
  const F = Array.from({ length: N }, () => new Array(N).fill(false)); // function modules (never masked)
  const set = (r, c, val) => { M[r][c] = val; F[r][c] = true; };

  // finders (+ separators)
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
      const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(rr, cc, on ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  // alignment patterns (skip the three that would sit on finders)
  const pos = ALIGN[v - 1];
  for (const r of pos) for (const c of pos) {
    if (F[r][c]) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
  }
  // timing
  for (let i = 8; i < N - 8; i++) { if (!F[6][i]) set(6, i, i % 2 === 0 ? 1 : 0); if (!F[i][6]) set(i, 6, i % 2 === 0 ? 1 : 0); }
  // dark module + reserved format areas
  set(N - 8, 8, 1);
  for (let i = 0; i < 9; i++) if (i !== 6) { F[8][i] = true; F[i][8] = true; }
  for (let i = 0; i < 8; i++) { F[8][N - 1 - i] = true; F[N - 1 - i][8] = true; }
  // version info (v ≥ 7): 6×3 block top-right, transposed bottom-left
  if (v >= 7) {
    const vi = versionBits(v);
    for (let i = 0; i < 18; i++) { const bit = (vi >> i) & 1, r = Math.floor(i / 3), c = N - 11 + (i % 3); set(r, c, bit); set(c, r, bit); }
  }

  // data: zig-zag two columns at a time from the right, skipping column 6
  const stream = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) stream.push((cw >> i) & 1);
  let bi = 0, up = true;
  for (let col = N - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < N; k++) {
      const r = up ? N - 1 - k : k;
      for (const c of [col, col - 1]) { if (F[r][c]) continue; M[r][c] = bi < stream.length ? stream[bi] : 0; bi++; }
    }
    up = !up;
  }

  // try all 8 masks; keep the lowest penalty
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const G = M.map((row) => row.slice());
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!F[r][c] && MASKS[mask](r, c)) G[r][c] ^= 1;
    writeFormat(G, N, formatBits(mask));
    const score = penalty(G, N);
    if (score < bestScore) { bestScore = score; best = G; }
  }
  return best;
}

function writeFormat(G, N, fmt) {
  for (let i = 0; i < 15; i++) {
    const mod = (fmt >> i) & 1;
    if (i < 6) G[i][8] = mod; else if (i < 8) G[i + 1][8] = mod; else G[N - 15 + i][8] = mod;   // vertical strip
    if (i < 8) G[8][N - i - 1] = mod; else if (i < 9) G[8][15 - i] = mod; else G[8][14 - i] = mod; // horizontal strip
  }
}

function penalty(G, N) {
  let s = 0;
  const runs = (get) => { for (let a = 0; a < N; a++) { let run = 1; for (let b = 1; b < N; b++) { if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; } else run = 1; } } };
  runs((a, b) => G[a][b]); runs((a, b) => G[b][a]);
  for (let r = 0; r + 1 < N; r++) for (let c = 0; c + 1 < N; c++) { const v = G[r][c]; if (v === G[r][c + 1] && v === G[r + 1][c] && v === G[r + 1][c + 1]) s += 3; }
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const finderLike = (get) => { for (let a = 0; a < N; a++) for (let b = 0; b + 10 < N; b++) { let m1 = true, m2 = true; for (let k = 0; k < 11; k++) { const v = get(a, b + k); if (v !== P1[k]) m1 = false; if (v !== P2[k]) m2 = false; } if (m1 || m2) s += 40; } };
  finderLike((a, b) => G[a][b]); finderLike((a, b) => G[b][a]);
  let dark = 0; for (const row of G) for (const v of row) dark += v;
  s += 10 * Math.floor(Math.abs((100 * dark) / (N * N) - 50) / 5);
  return s;
}

// Terminal rendering with half-blocks (2 rows per line). Light modules are drawn as white blocks
// so the code reads correctly on a dark terminal; a 2-module quiet zone is included.
export function qrToAscii(m, { quiet = 2 } = {}) {
  const N = m.length, W = N + 2 * quiet;
  const at = (r, c) => (r < quiet || c < quiet || r >= N + quiet || c >= N + quiet ? 0 : m[r - quiet][c - quiet]);
  const lines = [];
  for (let r = 0; r < W; r += 2) {
    let line = "";
    for (let c = 0; c < W; c++) {
      const top = at(r, c) === 0, bot = r + 1 < W ? at(r + 1, c) === 0 : true; // true = light
      line += top && bot ? "█" : top ? "▀" : bot ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function qrToSVG(m, { size = 256, quiet = 4, dark = "#000", light = "#fff" } = {}) {
  const N = m.length, W = N + 2 * quiet;
  let rects = "";
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m[r][c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${W}" height="${W}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
}
