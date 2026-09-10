# voxeled formats & interchange

voxeled's value is **the map** — where every LED is in real 3D space — as an open, reusable
artifact. This documents the canonical scene format and the interchange bridges.

## Coordinate conventions

- **Units:** millimetres, unless a scene's `units` says otherwise.
- **Axes:** right-handed, **+Y up**. The ground plane is XZ.
- **Normals:** unit vectors, pointing in each LED's **emission direction** (outward from the form).

## `.vxl.json` — the canonical scene (v0.0.1)

A *resolved scene* is the source of truth: a flat list of pixels in world space, plus the rig
metadata that produced them. It is plain JSON (`*.vxl.json`).

```jsonc
{
  "voxeled": "0.0.1",           // format version
  "name": "two-hearts",
  "units": "mm",
  "count": 9216,                // pixels.length
  "meta": {
    "pitchMM": 10,              // real inter-pixel spacing (viewers size LEDs from this)
    "instances": [              // the rig: one entry per placed fixture instance
      { "name": "left",  "fixture": "heart", "pos": [-1524,0,0], "rotDeg": [0,0,0] },
      { "name": "right", "fixture": "heart", "pos": [ 1524,0,0], "rotDeg": [0,0,0] }
    ]
    // …plus whatever the layout/generator recorded (spacing, fixture params, etc.)
  },
  "pixels": [
    // each pixel, minimum = position + normal:
    { "i": 0, "inst": 0, "p": [0.09, 288.34, -55], "n": [0.9955,-0.0946,-0.0041], "s": 0.0013, "v": -0.9167 }
    // i    global index (→ output byte offset i*3 for now)
    // inst which instance it belongs to (lets patterns re-base to fixture-local space)
    // p    world position (mm)
    // n    unit emission normal
    // s,v  optional fixture-local coords (here: arclength-around-loop, across-band)
  ]
}
```

**Addressing / patch.** The scene owns the *wiring*, not just the geometry: each fixture (or
instance) can carry an `output` block — protocol + address — and a single installation may mix
protocols. voxeled's dispatcher executes them. See [Patch — output mapping](#patch--output-mapping).
Without an `output` block, addressing is index-implied (pixel `i` → DDP offset `i·3` / Art-Net
universe `i/170`).

**Layout files** (`*.yaml`) are the *authoring* form — fixtures + instances + a show — from which
a `.vxl.json` is resolved. See [`DEMO-mobius-heart.md`](DEMO-mobius-heart.md) for the layout schema.

## Patch — output mapping

A fixture (or a single instance) carries an `output` block; voxeled's dispatcher
(`src/output/dispatch.mjs`) groups pixels by instance and fans each to its protocol — **one
installation can mix protocols**. Fixture-level `output` is the default; per-instance `output`
overrides it field-by-field (so every physical fixture can have its own host/universe).

```yaml
fixtures:
  heart:
    type: mobius-heart
    params: { ... }
    output: { protocol: artnet, host: 10.0.0.5, universe: 0, byteOrder: grb }  # fixture default
instances:
  - { fixture: heart, name: left,  pos: [...] }                                # inherits
  - { fixture: heart, name: right, pos: [...], output: { host: 10.0.0.6, universe: 4 } }  # override
```

| field | protocols | meaning |
|---|---|---|
| `protocol` | all | `artnet` \| `ddp` \| `danmx` \| a registered custom name |
| `host`, `port` | all | target IP + UDP port (defaults: artnet/danmx 6454, ddp 4048) |
| `byteOrder` | artnet, ddp | `rgb` \| `grb` \| `bgr` \| `rgbw` \| `grbw` … (white = min(r,g,b)) |
| `universe`, `channel` | artnet | start universe (0-based) + channel (1-based); pixels roll across universes |
| `offset` | ddp | start byte offset in the receiver framebuffer |
| `startPixel` | danmx | start pixel index in the dan-mx frame |

Built-in protocols: **Art-Net** (pixels merged into 512-ch universes per host/universe),
**DDP** (offset framebuffer, MTU-chunked), and **dan-mx**
([github.com/dnewcome/dan-mx](https://github.com/dnewcome/dan-mx)) — voxeled emits byte-compatible
RAW/RGB888 `DMX2` frames, MTU-chunked. **Custom protocols** plug in via
`createDispatcher(scene, { customProtocols: { name: (sock, plan, bytes, seq) => {…} } })` —
written once in voxeled, so every consumer (including the TiXL bridge) gets it for free.

Mixed-protocol demo (Art-Net + dan-mx + DDP from one show):
`node examples/mobius-heart/run.mjs examples/mobius-heart/layouts/patched.yaml`.

## Emitter — how the LEDs emit (simulation)

The map says where each LED is and which way it faces; the **emitter profile** says how it *emits*,
so the viewer's simulator (**S**) can show what the piece actually looks like — viewing-angle
falloff, the dark backside of every LED, occlusion by the bodies themselves, and diffusion glow.
It rides alongside `output` with the same precedence: fixture-type default (built into the
geometry, e.g. the heart's panel LED) < layout `fixtures.X.emitter` < per-instance `emitter`,
merged field-by-field, and lands in `meta.instances[k].emitter`.

```yaml
fixtures:
  heart:
    type: mobius-heart
    emitter: { softness: 0.6 }                                   # tweak the type default
instances:
  - { fixture: heart, name: left,  pos: [...] }
  - { fixture: heart, name: right, pos: [...], emitter: { viewingAngleDeg: 20 } }  # a spot variant
```

| field | default | meaning |
|---|---|---|
| `viewingAngleDeg` | 120 | datasheet **full** angle at 50% intensity. The lobe is `cosθ^p`, `p = ln½ / ln cos(angle/2)` — so **120° is exactly Lambertian**, ~10° a spot, ~1° laser-like, ~170° a diffused rope/tube. Behind the LED (θ > 90°) it is dark. |
| `sizeFrac` | 0.9 | emitter *body* edge as a fraction of pixel pitch (1.0 = contiguous panel tiles that form a surface; ~0.5 = a bare chip on a strand) |
| `coreFrac` | 0.5 | lit fraction of the body (the chip/lens); the rest is dark backing |
| `softness` | 0.4 | edge diffusion of the lit core (0 = hard chip, 1 = soft blob) |
| `gain` | 1.6 | emissive intensity (HDR; > 1 feeds bloom) |
| `glow` | 1.0 | bloom contribution (the diffusion halo) |

One shader covers the whole range because only the numbers change: a laser, a spot, a bare SMD
LED, a diffused strip, and a glowing rope are the same body with different `viewingAngleDeg` /
`softness` / `sizeFrac`. Each body is opaque and faces its normal — its front emits
`color × lobe(view angle) × core`, its back is dark backing, and both write depth, so the bodies
occlude one another (a panel ribbon's quads *are* the ribbon, dark on the back).

## glTF export (`.glb`) — the map travels

`node examples/mobius-heart/export.mjs [layout.yaml]` (or `make export`) writes a binary glTF 2.0
file that opens in Blender, TouchDesigner, three.js, or any glTF tool. Mapping:

| voxeled | glTF |
|---|---|
| each fixture **instance** | a named **node** with a **POINTS** mesh (mode 0) |
| pixel **position** (mm) | `POSITION` accessor, VEC3 float, **scaled to metres** (÷1000) |
| pixel **normal** | `NORMAL` accessor, VEC3 float (unit) |
| snapshot **colour** | `COLOR_0` accessor, VEC4 float |
| full scene `meta` + version | `asset.extras.voxeled` (lossless round-trip) |

So a rig imports as named point-cloud objects at real-world scale, each carrying normals and a
baked look. The `extras.voxeled` block lets a voxeled-aware tool recover the exact scene.

Verified: the exporter is round-trip-checked in `test/gltf.test.mjs` (spec-compliant GLB), and the
output loads + renders in three.js `GLTFLoader` (independent of voxeled's own viewer).

## glTF import (`.glb` → fixture)

The reverse bridge: author geometry anywhere (Blender), bring it in as a fixture. Inspect a file
with `node examples/mobius-heart/import.mjs file.glb` (or `make import GLB=…`); a layout uses it via
the `gltf` fixture type:

```yaml
fixtures:
  ring: { type: gltf, params: { file: examples/mobius-heart/assets/torus.glb } }
```

Every point of every mesh primitive becomes an LED. `NORMAL` is used if present (else estimated
outward from the centroid); positions are scaled glTF-metres → mm and node transforms are baked in.
Imported fixtures mix freely with native ones in one rig — see
[`layouts/imported.yaml`](../examples/mobius-heart/layouts/imported.yaml) (a glTF torus between two
Möbius hearts, all driven by one show).

Verified: export → import round-trips positions to **< 1 mm** with normals preserved
(`test/gltf-import.test.mjs`), and it reads a foreign POSITION-only GLB, filling the normals.

## Roadmap for interchange

- **MVR/GDTF import** — pull a pro-lighting rig (fixtures + mm positions) from Vectorworks/Depence.
- **Explicit patch** — per-pixel universe/channel/offset so the map carries its wiring.
- **Stable versioning** — `voxeled` bumps on breaking changes; importers check it.
