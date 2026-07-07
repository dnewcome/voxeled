# Demo — Möbius LED Heart

The first real driver of voxeled's Phase-0 spine, mapping and driving a concrete piece: the
[Möbius LED Heart](https://github.com/dnewcome/mobius-led-heart) — a steel heart-ribbon carrying
flexible LED panels, optionally given a half-twist so a single run of panels lights *both*
apparent sides.

It exercises the whole spine end-to-end:

```
heart_path parametrization → map.mjs → rig of N instances in shared world space
     (each pixel: world position + normal + fixture coords s,v + instance id)
           → hub runs a crossfading show → normalized RGB frames
                 → WebGL viewer + crossfader (WebSocket)  ← preview & control
                 → Art-Net + DDP senders (UDP)            ← real fixtures
```

## Run it

```bash
node examples/mobius-heart/run.mjs      # or: npm run demo   (Node ≥18, no dependencies)
# open http://localhost:8080
```

By default it builds a **rig of two hearts, 10 ft apart**, and runs an **auto-crossfading show**
through three scenes. In the viewer:

- **drag** orbit · **scroll** zoom
- **N** — toggle the normal quills
- the **crossfader** (bottom-left) — dissolve between the first two scenes by hand; **[** / **]**
  nudge it, **A** returns to auto

Knobs (env vars):

| var | default | effect |
|---|---|---|
| `VOX_HEARTS` | `2` | number of heart instances in the rig |
| `VOX_SPACING_FT` | `10` | feet between instances (real world distance) |
| `VOX_PATTERN` | — | run ONE pattern instead of the show: `ribbonChase` \| `worldWipe` \| `planeSweep` \| `normalRGB` |
| `VOX_TWIST` | `mobius` | `mobius` \| `cookie-cutter` \| `flat-full` |
| `VOX_PANELS` | `8` | panels per side (sets the size) |
| `VOX_PITCH` | `10` | demo pixel pitch in mm (smaller = more pixels) |
| `ARTNET` | — | host to stream Art-Net to (e.g. `192.168.1.50`) |
| `DDP` | — | host to stream DDP to (e.g. `192.168.1.60`) |

```bash
VOX_HEARTS=3 VOX_SPACING_FT=6 node examples/mobius-heart/run.mjs   # three hearts, 6 ft apart
VOX_PATTERN=worldWipe node examples/mobius-heart/run.mjs           # one pattern, no crossfade
ARTNET=192.168.1.50 node examples/mobius-heart/run.mjs             # + drive real Art-Net fixtures
```

Just the map, no server:

```bash
node examples/mobius-heart/map.mjs --hearts 2 --spacing 10 --pitch 10 --twist mobius
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

## Patterns

- **`ribbonChase`** — a hue chase in ribbon-arclength `s`; watch it flow around and come back on
  the far side via the Möbius twist. Uses *fixture-local* `s`, so every instance stays in sync.
- **`worldWipe`** — a plane of light wiping along a world axis. Its `space` flag is the distance
  toggle (below): `world` accounts for the gap between instances, `fixture` syncs them.
- **`planeSweep`** — repeating planes rising at a real speed (mm/s). Purely world-space — proves
  the animation is *spatial*, reading correctly across the non-flat, twisting ribbon.
- **`normalRGB`** — paints each pixel's emission normal as colour (x,y,z → r,g,b). Always lit; the
  colour field you see *is* the emission-direction field — the direct visual proof the map is right.

## Multiple instances & the "account for distance" toggle

The scene is a **rig**: one heart *fixture* (its local geometry) placed as N *instances*, each with
a world transform (translation in mm + Euler rotation). `VOX_HEARTS=2 VOX_SPACING_FT=10` puts two
hearts 3048 mm apart in one shared world space. Each pixel then carries its **world** position
(after the instance transform) plus its `instance id`, so a pattern can choose which space to think in:

| space | with 2 hearts 10 ft apart | use it for |
|---|---|---|
| **world** | one wave crosses heart A, the empty 10-ft gap (dark, taking real time), then heart B — the distance is physically accounted for | a pattern that spans the whole installation |
| **fixture** | both hearts show the identical wave in sync; the gap is ignored | cloning one look across identical props |

`worldWipe({ space })` is exactly this switch. The hub supplies `ctx.local(px)` — it re-bases a
world pixel back into its instance's frame via the inverse transform — so *any* world-space pattern
can be made per-instance by sampling `ctx.local(px)` instead of `px.p`.

## Crossfading scenes

A **scene** is a look — a name + a pattern with its params bound. The **show** (`src/mixer.mjs`)
runs two scenes as A/B decks and dissolves between them by a fader `x ∈ [0,1]` (linear RGB lerp).
In **auto** mode it cycles the scene list on a timeline (hold, then crossfade to the next); the
viewer's **crossfader** overrides into **manual** and drives the fader directly (over a tiny
`GET /control` endpoint on the same server). The default show is:

```
chase (per-heart)  →  wipe · across (world)  →  wipe · synced (fixture)
```

so the auto-crossfade itself dissolves between the distance-aware and the synced looks.

## Driving the real piece

The heart's panels are HUB75 (or a transparent SPI film). voxeled stays protocol-side:

- **Art-Net / DDP → a Pi running FPP → HUB75** (FPP maps a pixel overlay onto `rpi-rgb-led-matrix`),
  or **DDP → WLED / the film's control box** for the transparent variant.
- The **same frames** drive the browser preview and the fixtures, so what you author is what lights.

## Verified

Headless checks (`✅ 36/36` across three suites): mapper emits unit normals with real 3D depth
from the twist; Art-Net framing (header, opcode `0x5000`, universe paging) and DDP framing
(version/PUSH flags, offset, length); the WebSocket bus (RFC-6455 handshake + full-frame binary
delivery); multi-instance placement + `ctx.local()` re-basing; `worldWipe` treating world vs
fixture space differently; the mixer crossfade (endpoints, midpoint, auto timeline); and the
`/control` endpoint mutating the fader. The browser render is the one piece a headless run can't
exercise — its data contract (fetch `scene.json` + binary WS frames + `GET /control`) is what those checks cover.

## Files

```
examples/mobius-heart/
  heart.mjs   port of heart_path.py + the ribbon frame (F = T × D); samples a heart fixture
  map.mjs     place N instances → a voxeled scene/rig (the "map"); also a CLI
  run.mjs     the full demo: rig → crossfading show → bus + senders (the "drive")
src/
  format.mjs  .vxl scene v0 (build/save/load/bounds)
  layout.mjs  place fixture instances by world transform into a shared-space rig
  patterns.mjs  spatial patterns: ribbonChase, worldWipe (world/fixture), planeSweep, normalRGB
  mixer.mjs   the show — crossfade between scenes (auto timeline or manual fader)
  hub.mjs     runs the shade fn, builds ctx (incl. per-instance local()), fans frames out
  bus.mjs     dependency-free WebSocket bus + static/control HTTP server
  senders/artnet.mjs, senders/ddp.mjs   UDP output
  vec.mjs     tiny 3-vector + rotation-matrix helpers
viewer/index.html   three.js point-cloud viewer + crossfader (subscribes to the bus)
```
