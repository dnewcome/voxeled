// `tube` — a flexible LED matrix panel (8×32, 10 mm pitch is the common one) rolled into a
// cylinder, one or more panels end to end inside a diffuser tube: a standing column of light.
//
// The short side goes AROUND: cols × pitch of circumference (+ a seam gap for the wire exit), so
// an 8-wide panel makes a Ø 80/π ≈ 25.5 mm roll, Ø 28.6 mm with a 10 mm seam. The long side runs
// ALONG the axis (+Y, base at y = 0 — `pos` is where the column stands on the ground). Normals
// are radial. Data order follows the panel's wiring: these panels snake along the short side, so
// each column of 8 becomes one RING and successive rings alternate direction (serpentine); a
// panel wired along its long side instead (`wiring: along`) makes cols zigzag lines up the tube.
//
//   { type: tube, params: { cols: 8, rows: 32, panels: 3, pitchMM: 10, seamMM: 10 } }   → 768 px, 960 mm
export function tubeFixture({ cols = 8, rows = 32, panels = 1, pitchMM = 10, seamMM = 0, panelGapMM = 0, diameterMM, wiring = "across", serpentine = true, startAngleDeg = 0, clockwise = false, rowPitchMM } = {}) {
  const circ = cols * pitchMM + seamMM;
  const R = (diameterMM ?? circ / Math.PI) / 2;
  const rp = rowPitchMM ?? pitchMM;
  const rowsTotal = rows * panels;
  const height = rowsTotal * rp - rp + panelGapMM * (panels - 1);
  const pixels = [];
  const angleOf = (k) => ((startAngleDeg + (clockwise ? -1 : 1) * ((k * pitchMM) / circ) * 360) * Math.PI) / 180;
  const yOf = (row, panel) => panel * (rows * rp + panelGapMM) + row * rp + rp / 2 - rp / 2; // first ring at y = 0
  const put = (k, row, panel) => {
    const a = angleOf(k), y = yOf(row, panel), gy = panel * rows + row;
    pixels.push({
      i: pixels.length,
      p: [+(R * Math.cos(a)).toFixed(3), +y.toFixed(3), +(R * Math.sin(a)).toFixed(3)],
      n: [+Math.cos(a).toFixed(4), 0, +Math.sin(a).toFixed(4)],
      s: rowsTotal > 1 ? +(gy / (rowsTotal - 1)).toFixed(5) : 0, // along the column, 0 at the base
      v: +(k / cols).toFixed(5),                                  // around
      strand: panel,
    });
  };
  for (let panel = 0; panel < panels; panel++) {
    if (wiring === "across") {
      // data runs around each ring, rings alternate direction
      for (let row = 0; row < rows; row++) for (let j = 0; j < cols; j++) put(serpentine && row % 2 ? cols - 1 - j : j, row, panel);
    } else if (wiring === "along") {
      // data runs up each line, lines alternate direction around the tube
      for (let k = 0; k < cols; k++) for (let j = 0; j < rows; j++) put(k, serpentine && k % 2 ? rows - 1 - j : j, panel);
    } else throw new Error(`tube wiring must be across | along (got "${wiring}")`);
  }
  return {
    pixels,
    meta: {
      source: "tube", pitchMM, points: pixels.length, cols, rows, panels, diameterMM: +(2 * R).toFixed(2), circumferenceMM: circ, seamMM, heightMM: +height.toFixed(1), wiring, serpentine, strands: panels,
      // 5050s behind a frosted tube: wide, soft, contiguous
      emitter: { viewingAngleDeg: 150, sizeFrac: 1.0, coreFrac: 0.55, softness: 0.75, gain: 1.5, glow: 1.2 },
    },
  };
}
