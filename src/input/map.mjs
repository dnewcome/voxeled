// Input map — DMX-style universes/channels → voxeled pixels, as DATA. The receiving end of the
// patch: where the output patch says where each fixture's pixels GO, an input map says which
// pixel each incoming channel IS. Three forms:
//
//   (none)     sequential: universe u, channel 3j+1 → pixel base + u·perUniverse + j   (perUniverse 170)
//   segments:  explicit runs — [{ universe, channel: 1, pixel, count, dir: 1|-1 }, …]
//   strings:   the "N strings of M LEDs, k universes each" wiring most pixel controllers have —
//              with the two things that always bite: a string wired as two strips from both ends
//              (stripB), and the controller's string order not being the layout's (groups.order).
//              Thread/luxpi: strings 12, universesPerString 4, perUniverse 150, stripB doc|luxpi,
//              groups { size: 3, order: [tube-for-X, tube-for-Y, tube-for-Z, spine-for-W] }, flip.
//
// The result is a lookup table per universe: slot j (channels 3j+1..3j+3) → pixel index, or −1.
export function buildInputMap(spec = {}, N) {
  const table = new Map();
  const covers = new Uint8Array(N);
  const slot = (universe, j, pixel) => {
    if (pixel < 0 || pixel >= N) return;
    let t = table.get(universe);
    if (!t) { t = new Int32Array(170).fill(-1); table.set(universe, t); }
    if (j < 170) { t[j] = pixel; covers[pixel] = 1; }
  };
  if (spec.segments) {
    for (const seg of spec.segments) {
      const { universe, channel = 1, pixel = 0, count = 170, dir = 1 } = seg;
      if (universe == null) throw new Error("input map segment needs a `universe`");
      const j0 = ((channel - 1) / 3) | 0;
      for (let j = 0; j < count; j++) slot(universe, j0 + j, pixel + j * dir);
    }
  } else if (spec.strings) {
    const strings = spec.strings | 0, uPS = spec.universesPerString || 4, per = spec.perUniverse || 150;
    const perString = spec.perString || uPS * per, half = uPS >> 1, stripB = spec.stripB || "doc";
    if (!["doc", "luxpi", "none"].includes(stripB)) throw new Error(`input map stripB must be doc | luxpi | none (got "${stripB}")`);
    const gsize = spec.groups?.size || 1, order = spec.groups?.order || null;
    const ubase = spec.universe || 0, pbase = spec.pixel || 0;
    for (let u = 0; u < strings * uPS; u++) {
      const sIn = (u / uPS) | 0, q = u % uPS;                  // controller string, universe-in-string
      const g = (sIn / gsize) | 0, k = sIn % gsize;             // controller group + string-in-group
      const s = (order ? order[g] : g) * gsize + k;             // layout string
      if (s == null || s >= strings) continue;
      for (let j = 0; j < per; j++) {
        let p;
        if (q < half || stripB === "none") p = q * per + j;                       // strip A, in order
        else if (stripB === "luxpi") p = q * per + (per - 1 - j);                // each universe reversed within itself
        else p = perString - 1 - ((q - half) * per + j);                          // strip B from the far end
        if (spec.flip) p = perString - 1 - p;
        slot(ubase + u, j, pbase + s * perString + p);
      }
    }
  } else {
    const per = spec.perUniverse || 170, ubase = spec.universe || 0, pbase = spec.pixel || 0;
    for (let p = pbase, u = ubase; p < N; u++) for (let j = 0; j < per && p < N; j++, p++) slot(u, j, p);
  }
  const universes = [...table.keys()].sort((a, b) => a - b);
  return { table, covers, universes, covered: covers.reduce((a, b) => a + b, 0) };
}
