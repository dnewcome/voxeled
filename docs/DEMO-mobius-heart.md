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

By default it loads [`layouts/two-hearts.yaml`](../examples/mobius-heart/layouts/two-hearts.yaml)
— a **rig of two hearts, 10 ft apart** — and runs its **auto-crossfading show**. In the viewer:

- **drag** orbit · **scroll** zoom
- **N** — toggle the normal quills
- the **crossfader** (bottom-left) — dissolve between the first two scenes by hand; **[** / **]**
  nudge it, **A** returns to auto

The rig, fixture params, and scene list all live in the **layout file** (see below) — edit the
YAML, not env vars. What remains as env:

| var | default | effect |
|---|---|---|
| `VOX_LAYOUT` | `…/layouts/two-hearts.yaml` | which YAML layout to load |
| `VOX_PATTERN` | — | run ONE pattern instead of the show: `ribbonChase` \| `worldWipe` \| `planeSweep` \| `normalRGB` |
| `ARTNET` | — | host to stream Art-Net to (e.g. `192.168.1.50`) |
| `DDP` | — | host to stream DDP to (e.g. `192.168.1.60`) |

```bash
VOX_LAYOUT=examples/mobius-heart/layouts/grid-3x3.yaml node examples/mobius-heart/run.mjs      # 3×3 matrix, 9 hearts
VOX_LAYOUT=examples/mobius-heart/layouts/facing-hearts.yaml node examples/mobius-heart/run.mjs # 4 hearts, alternating 180°
VOX_PATTERN=worldWipe node examples/mobius-heart/run.mjs           # one pattern, no crossfade
ARTNET=192.168.1.50 node examples/mobius-heart/run.mjs             # + drive real Art-Net fixtures
```

Shortcuts (Makefile, same as the `npm run demo:*` scripts):

```bash
make grid        # 3×3 matrix        make demo     # default two-hearts
make facing      # 4 rotated hearts  make test     # full suite + render gate
make stop        # free port 8080    make restart  # stop + demo
```

Just the map (programmatic, writes a scene file):

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

## Layout files (YAML)

The rig is a declarative YAML file — fixtures, their instances, and the show. The default:

```yaml
name: two-hearts
units: mm

fixtures:
  heart:
    type: mobius-heart          # a registered fixture type (run.mjs → FIXTURES)
    params: { panelsPerSide: 8, pitchMM: 10, twist: mobius }

instances:                      # copies in shared world space (mm, degrees)
  - { fixture: heart, name: left,  pos: [-1524, 0, 0] }
  - { fixture: heart, name: right, pos: [ 1524, 0, 0] }

show:
  holdS: 4
  fadeS: 2.5
  scenes:
    - { name: chase,  pattern: ribbonChase }
    - { name: across, pattern: worldWipe, params: { space: world } }
    - { name: synced, pattern: worldWipe, params: { space: fixture } }
```

- **fixtures** — reusable geometry built by a registered `type` + `params`. Add a new fixture
  type by registering a `(params) => { pixels, meta }` function in `run.mjs`'s `FIXTURES` map.
- **instances** — placements: `pos` (mm) and optional `rotDeg` (Euler degrees).
  [`facing-hearts.yaml`](../examples/mobius-heart/layouts/facing-hearts.yaml) shows rotation.
- **show** — the scene list the mixer crossfades; each scene is a `pattern` + `params`.

Point `VOX_LAYOUT` at any file. Parsing is a small dependency-free YAML *subset* (`src/yaml.mjs`)
— block maps/sequences, inline `[…]`/`{…}` flow, comments, typed scalars — enough for layout
files; swap in `js-yaml` if you outgrow it.

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

Run `npm test` — **58 checks across five suites** (`test/`): the mapper's unit normals + twist
depth; Art-Net framing (header, opcode `0x5000`, universe paging) and DDP framing (version/PUSH
flags, offset, length); the WebSocket bus (RFC-6455 handshake + full-frame binary delivery);
multi-instance placement + `ctx.local()` re-basing; `worldWipe` world-vs-fixture; the mixer
crossfade (endpoints, midpoint, auto timeline); the `/control` endpoint; the YAML-subset parser +
`resolveLayout` (both real layout files + error handling); and — the piece that used to be
unverifiable — a **headless-Chrome render gate** that boots the viewer, asserts it built its
geometry (the `VOXELED_READY` console signal) with no errors, and confirms it loads **offline**
(no CDN). The gate skips cleanly if Chrome isn't installed. The browser render is covered now too.

## Files

```
examples/mobius-heart/
  heart.mjs   port of heart_path.py + the ribbon frame (F = T × D); samples a heart fixture
  map.mjs     place N instances → a voxeled scene/rig (the "map"); also a CLI
  run.mjs     the full demo: load YAML layout → crossfading show → bus + senders (the "drive")
  layouts/    YAML layout files — two-hearts.yaml (default), grid-3x3.yaml, facing-hearts.yaml
src/
  format.mjs  .vxl scene v0 (build/save/load/bounds)
  yaml.mjs    dependency-free YAML-subset parser (layout files)
  layout.mjs  buildSceneFromLayout + resolveLayout (parsed YAML doc → scene + show)
  patterns.mjs  spatial patterns: ribbonChase, worldWipe (world/fixture), planeSweep, normalRGB
  mixer.mjs   the show — crossfade between scenes (auto timeline or manual fader)
  hub.mjs     runs the shade fn, builds ctx (incl. per-instance local()), fans frames out
  bus.mjs     dependency-free WebSocket bus + static/control HTTP server
  senders/artnet.mjs, senders/ddp.mjs   UDP output
  vec.mjs     tiny 3-vector + rotation-matrix helpers
viewer/index.html   three.js point-cloud viewer + crossfader (subscribes to the bus)
viewer/vendor/      three.js + OrbitControls, vendored locally (no CDN — runs offline)
test/               `npm test` — logic suites + a headless-Chrome render gate
```
