# voxeled ← Rhino / Grasshopper

Grasshopper is where parametric LED placement really lives — *Divide Curve*, *Populate Surface*,
*Evaluate Surface* for normals. The `voxeled_export.py` script component takes those results and
writes a voxeled fixture (**points + emission normals + strand + order**).

## Wiring

1. Drop a **Python** component (GhPython in Rhino 7, or the Python 3 script component in Rhino 8)
   and paste `voxeled_export.py` into it. Works in IronPython 2.7 and CPython 3.
2. Add inputs (set each to *list access*):
   - **P** — the LED points (`Point3d`), in document units. **List order = data order** — the
     order voxeled will address (pixel *i* → byte *i·3*). Divide Curve already gives you this.
   - **N** — normals (`Vector3d`), optional. Use the surface / curve frame normal, or a vector
     toward where the LEDs point. Without it the script estimates outward-from-centroid normals
     and says so (check them with **N** in the viewer).
   - **S** — strand id per point (int), optional — which strip/rope each point belongs to.
   - **Scale** — document units → mm: `1` for mm documents, `1000` for metres, `25.4` for inches.
   - **Pitch** — LED spacing in mm, optional (estimated from the points if blank).
   - **File** — output path, **Write** — a Boolean toggle to write.
3. Outputs: **JSON** (the fixture; put a Panel on it), **Count**, **Info**.

Then:

```bash
vox check piece.vxl.json
vox preview piece.vxl.json
```

and in a layout: `fixtures: { piece: { type: vxl, params: { file: piece.vxl.json } } }`.

The conversion (`to_fixture`) is pure Python and is unit tested from voxeled's suite with plain
`python3`.
