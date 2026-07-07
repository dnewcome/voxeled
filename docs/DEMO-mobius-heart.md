# Demo — Möbius LED Heart

The first real driver of voxeled's Phase-0 spine, mapping and driving a concrete piece: the
[Möbius LED Heart](https://github.com/dnewcome/mobius-led-heart) — a steel heart-ribbon carrying
flexible LED panels, optionally given a half-twist so a single run of panels lights *both*
apparent sides.

It exercises the whole spine end-to-end:

```
heart_path parametrization → map.mjs → scene (position + normal + s,v per pixel)
        → hub runs a spatial pattern → normalized RGB frames
              → WebGL viewer (WebSocket)   ← preview
              → Art-Net + DDP senders (UDP) ← real fixtures
```

## Run it

```bash
node examples/mobius-heart/run.mjs      # or: npm run demo
# open http://localhost:8080
```

Drag to orbit, scroll to zoom, press **N** to toggle the normal quills.

Knobs (env vars):

| var | default | effect |
|---|---|---|
| `VOX_PATTERN` | `ribbonChase` | `ribbonChase` \| `planeSweep` \| `normalRGB` |
| `VOX_TWIST` | `mobius` | `mobius` \| `cookie-cutter` \| `flat-full` |
| `VOX_PANELS` | `8` | panels per side (sets the size) |
| `VOX_PITCH` | `10` | demo pixel pitch in mm (smaller = more pixels) |
| `ARTNET` | — | host to stream Art-Net to (e.g. `192.168.1.50`) |
| `DDP` | — | host to stream DDP to (e.g. `192.168.1.60`) |

```bash
VOX_PATTERN=ribbonChase node examples/mobius-heart/run.mjs   # chase that returns via the twist
ARTNET=192.168.1.50 node examples/mobius-heart/run.mjs        # + drive real Art-Net fixtures
```

Just the map, no server:

```bash
node examples/mobius-heart/map.mjs --panels 8 --pitch 10 --twist mobius
```

## The mapping — why this piece is the ideal first target

Because the heart is **generated from a parametric ribbon**, every LED's world position *and*
emission normal are exact — no camera scan, no averaging of CAD tube normals (the thread-3d
blocker). At perimeter arclength `arc`, `heart_path` gives:

- `point(arc)` — a point on the centreline (mm),
- `tangent(arc)` = **T** — along the ribbon,
- `widthDir(arc)` = **D** = `Ẑ·cosθ + R̂·sinθ` — across the band, spiralling with the twist,
- and the lit-face **emission normal is `F = T × D`** — exactly what the sculpture's own
  simulator computes.

A pixel at across-offset `off ∈ [−band/2, +band/2]` is `p = point(arc) + D·off`, with normal `F`.
Each pixel also carries a ribbon coordinate `(s, v)` = (normalized arclength around the loop,
across the band). Content that flows in `s` travels around the loop and **returns on the "other"
apparent side through the Möbius half-twist** — the geometric payoff, made drivable.

This is voxeled's importer stance in miniature: a procedural piece is mapped by *evaluating its
parametrization*; a scanned piece would instead come from the camera automapper (Phase 2) — but
both land in the same scene shape (`position + normal + address`).

## The three patterns

- **`ribbonChase`** (default) — a hue chase in ribbon-arclength `s`; watch it flow around and come
  back on the far side via the Möbius twist.
- **`planeSweep`** — planes of light rising at a real speed (mm/s), repeating so a band is always
  on the piece. Purely world-space — proves the animation is *spatial*, reading correctly across
  the non-flat, twisting ribbon.
- **`normalRGB`** — paints each pixel's emission normal as colour (x,y,z → r,g,b). Always lit; the
  colour field you see *is* the emission-direction field — the direct visual proof the map is right.

## Driving the real piece

The heart's panels are HUB75 (or a transparent SPI film). voxeled stays protocol-side:

- **Art-Net / DDP → a Pi running FPP → HUB75** (FPP maps a pixel overlay onto `rpi-rgb-led-matrix`),
  or **DDP → WLED / the film's control box** for the transparent variant.
- The **same frames** drive the browser preview and the fixtures, so what you author is what lights.

## Verified

Headless checks (`✅ 17/17`): mapper emits unit normals with real 3D depth from the twist;
Art-Net framing (header, opcode `0x5000`, universe paging); DDP framing (version/PUSH flags,
offset, length); WebSocket bus (RFC-6455 handshake + full-frame binary delivery). The browser
render is the one piece a headless run can't exercise — its data contract is what those checks cover.

## Files

```
examples/mobius-heart/
  heart.mjs   port of heart_path.py + the ribbon frame (F = T × D); samples pixels
  map.mjs     evaluate the parametrization → a voxeled scene (the "map"); also a CLI
  run.mjs     the full demo: map → hub → bus + senders (the "drive")
src/
  format.mjs  .vxl scene v0 (build/save/load/bounds)
  patterns.mjs  spatial patterns: planeSweep, ribbonChase, normalShade
  hub.mjs     runs a pattern, fans identical frames to bus + senders
  bus.mjs     dependency-free WebSocket bus + static server
  senders/artnet.mjs, senders/ddp.mjs   UDP output
  vec.mjs     tiny 3-vector helpers
viewer/index.html   three.js point-cloud viewer (subscribes to the bus)
```
