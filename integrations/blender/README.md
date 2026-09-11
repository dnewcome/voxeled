# voxeled ← Blender

**File ▸ Export ▸ voxeled fixture (.vxl.json)** — bake LED positions **and emission normals** out
of Blender into a voxeled fixture. Blender is also the universal hub: it imports STEP, 3DM, OBJ,
glTF, so anything an artist has can pass through here on its way to a piece.

## Install

- **Blender 4.2+ / 5.x as an extension:** zip this folder (`blender_manifest.toml`, `__init__.py`,
  `voxeled_export.py`) and *Edit ▸ Preferences ▸ Get Extensions ▸ ⌄ ▸ Install from Disk*.
- **Legacy add-on:** *Preferences ▸ Add-ons ▸ Install* and pick `voxeled_export.py`.

Tested headless against Blender 5.2 (`test/toolchain-exporters.test.mjs` runs a real export).

## What becomes an LED

| object | mode | LED | normal |
|---|---|---|---|
| **Mesh** | `vertices` (default) | every vertex | vertex normal |
| **Mesh** | `faces` | every face centre — **panels modelled as quads** | face normal |
| **Mesh** | `islands` | every connected island — **modelled LED chips** | the chip's thin axis (sign: outward from the piece) |
| **Curve** | — | sampled every *pitch* mm along the evaluated curve; the LED sits `voxeled_radius` mm off the axis at `voxeled_angle`° around it — **a rope on a tube** | radial (away from the axis), parallel-transport frame; angle 0 = on top |
| **Empty** | — | its origin — a single aimed LED | its local +Z |

Each object is one **strand** (data order = vertex / curve order, `s` runs 0→1 along it). Positions
are world-space, converted to **mm** from the scene's unit scale. Set per-object **custom
properties** to override the export defaults: `voxeled_mode`, `voxeled_pitch`, `voxeled_radius`,
`voxeled_angle`.

Then, in voxeled:

```bash
vox check piece.vxl.json        # normals present, order sane, pitch, units
vox preview piece.vxl.json      # look at it (S for the simulator, N for the normals)
```

```yaml
fixtures:
  piece: { type: vxl, params: { file: piece.vxl.json } }   # place it in a layout like any fixture
```

The geometry core (`fixture_from_objects`) is pure Python with no `bpy` dependency, so it is unit
tested outside Blender; `collect()` is the thin bpy layer.
