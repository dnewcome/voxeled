# voxeled

**Open, integration-friendly volumetric LED show control.**

Drive real fixtures from *spatial* animations authored in **real-world units** — so motion reads smoothly across LEDs that aren't evenly spaced. Reuse the geometry and fixtures you already have (Blender, glTF/USD, GDTF/MVR). Preview in the browser and light up the real thing from the *same frames*.

![status](https://img.shields.io/badge/status-early%20design-orange)
![license](https://img.shields.io/badge/license-MIT-blue)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

> **Status: Phase 0 — the spine runs.** A working demo maps and drives the [Möbius LED Heart](https://github.com/dnewcome/mobius-led-heart): a scene → a hub running one spatial pattern → a WebGL preview *and* Art-Net/DDP output, all from identical frames (`npm run demo`; verified by 17 headless checks). This is an early slice, not a finished product — the stable format, the importers, and the automapper are still ahead. The longer-horizon code samples further down are marked **illustrative**. Watch/star to follow along.

## Try it — Möbius LED Heart

The first working slice maps and drives a real piece, the [Möbius LED Heart](https://github.com/dnewcome/mobius-led-heart):

```bash
node examples/mobius-heart/run.mjs      # or: npm run demo   (Node ≥18, no dependencies)
# open http://localhost:8080  ·  drag the crossfader  ·  press N for normals
```

Because the heart is generated from a parametric ribbon, voxeled maps it by *evaluating that parametrization* — every LED gets an exact position **and** emission normal (`F = T × D`), no camera scan needed. The default demo places **two hearts 10 ft apart** in one world space and **auto-crossfades a show** across them — including a wipe that accounts for the real gap between them (world space) and a synced version that ignores it (fixture space). The rig — how many hearts, where they sit, and the scene list — is a small [YAML layout file](examples/mobius-heart/layouts/two-hearts.yaml) you can edit (`VOX_LAYOUT=…`). Identical frames drive the browser preview and real fixtures over Art-Net/DDP (`ARTNET=host DDP=host …`). Full walkthrough: [`docs/DEMO-mobius-heart.md`](docs/DEMO-mobius-heart.md).

---

## Why

There are good LED tools, but each one boxes you in:

- **LX Studio / Chromatik** nails the right *idea* — pixels as a positioned 3D point cloud, patterns as spatial functions — but it's a monolithic Java desktop app. Custom patterns compile against the app, geometry import is painful, and it doesn't round-trip to any standard format. Powerful, but hard to integrate with anything else.
- **MADRIX 5** does true volumetric (voxel) rendering beautifully — and is Windows-only, closed, and gated behind a USB dongle priced by channel count.
- **xLights** is open and capable, but its mental model is a 2D buffer you *project* onto geometry — awkward for genuine volumes — and it's built for a sequence-and-play pipeline, not real-time embedding.

None of them combine **real-world-unit spatial animation** with **open, cross-platform, integration-friendly** interchange. That gap is the whole point of voxeled.

**The wedge is integration.** voxeled is not one big app — it's an **ecosystem of small cooperating parts** around a stable, open contract: WebGL visualizers, Blender plugins, protocol senders/sinks, and the network glue between them.

## Core ideas

- **3D is the native render space.** Every pixel is a *positioned point* with a *normal* (which way its light points). Patterns are spatial functions of world position + time — `f(x, y, z, t) → color` — not per-index effects on a rectangle. This is the one thing worth keeping from LX, and it's the core value.
- **Real-world units, everywhere.** Positions are in millimeters. A "sweep 200 mm/s up the rig" reads correctly whether pixels are 10 mm or 300 mm apart.
- **A live hub + a normalized pixel bus.** One process holds the scene, runs the pattern engine, and fans identical frames out to every consumer at once. **Preview == output.**
- **Own the format, import the world.** A small, versioned, pixel-first scene format is the source of truth — with importers for glTF/USD (meshes), and GDTF/MVR (pro fixtures + rigs, positions already in mm). Reuse assets; don't reinvent them, and don't get locked into someone else's schema.

## Architecture

```
     authoring / import                    runtime spine                          outputs
 ┌────────────────────────┐        ┌───────────────────────────┐        ┌───────────────────────────┐
 │ Blender plugin (GN)    │        │        voxeled hub        │        │  WebGL visualizer(s)      │
 │ glTF / USD import      │        │  ┌─────────────────────┐  │ frames │  (WebSocket)              │
 │ GDTF / MVR import      │──scene─▶│  │ sparse point cloud  │  │───────▶├───────────────────────────┤
 │ camera automapper      │ (.vxl) │  │ spatial pattern eng.│  │───────▶│  DDP · sACN · Art-Net     │
 │                        │        │  │ normalized pixel bus│  │ frames │  senders → real fixtures  │
 └────────────────────────┘        │  └─────────────────────┘  │        └───────────────────────────┘
                                    └───────────────────────────┘
       geometry + normals              same frames to everyone          preview and reality match
```

Every arrow is a boundary you can plug into. A visualizer is just a bus consumer. A new protocol is just a sender. A new geometry source is just something that emits a scene.

## Lineage

voxeled grows directly out of [**thread-3d**](https://github.com/dnewcome/thread-3d) — a real-time Three.js visualizer for a 12-strand, 7,200-LED spiral sculpture, driven live over Art-Net. thread-3d proved the core loop (CAD model → LED point cloud → live-lit 3D view) and surfaced the exact problems voxeled exists to generalize:

- **CAD → points was bespoke.** thread-3d extracts LED positions by parsing an STL, detecting strand breaks from centroid jumps, and binning triangles evenly per strand — clever, but hardcoded to `12 × 600` and dependent on triangle export order. voxeled replaces this with a declarative scene format + reusable importers.
- **Positions, but no normals.** thread-3d recovers positions, not a per-LED *emission direction* — and because the LEDs ride a swept tube, averaging that tube's radial face normals cancels out. "Which way does the light point" is precisely the bit voxeled makes first-class: the answer is the **sculpture's surface normal** at each point (outward from the form), not the tube's. See the normals discussion in [`docs/DESIGN.md`](docs/DESIGN.md).
- **Browsers can't receive UDP,** so thread-3d had to be an Electron app to open the Art-Net socket. voxeled fixes this at the architecture level: the **hub** owns the UDP/Art-Net/DDP side and streams frames to browser visualizers over **WebSocket** — so viewers are pure web pages, and thread-3d's renderer becomes just one more bus consumer.

## The scene format (proposed)

A voxeled scene co-locates **geometry**, **per-output addressing**, and **user parameters** in one declarative file — borrowing Chromatik's best idea, kept small and stable. Geometry can be authored inline or *referenced* from imported assets.

```toml
# scene.vxl — illustrative
units = "mm"                          # real-world units are the whole point

[[fixture]]
name = "left-arch"
mesh = "arches.glb#LeftArch"          # reuse imported geometry, don't redraw it

  [[fixture.strip]]
  count   = 144
  path    = "curve:LeftArch.Rail"     # positions sampled along the curve
  normals = "surface"                 # emission direction from the mounting face,
                                       # NOT the strip's travel direction

  [fixture.output]
  protocol   = "ddp"                  # DDP-first for high pixel counts
  host       = "192.168.1.50"
  offset     = 0
  byte_order = "grb"
```

Each pixel resolves to, at minimum, **`position + normal + address`**. The normal is a first-class field — carried through glTF as the standard `NORMAL` attribute / USD `normals` primvar so it survives round-trips.

A pattern is a spatial function, not a per-index loop:

```js
// world-space, real units — 200 mm/s wave sweeping up the rig
export const wave = ({ x, y, z }, t) =>
  hsv(0.6, 1, clamp(Math.sin((y - t * 200) / 40)))
```

## Protocols

| Protocol | Why | voxeled |
|---|---|---|
| **DDP** | Offset-addressed flat framebuffer — no 512-channel fragmentation, no DMX refresh cap. Best for high pixel counts. | **primary** |
| **sACN / E1.31** | Industry-standard IP-DMX, clean multicast, priority — pro/console interop. | planned |
| **Art-Net** | Broadest reach; legacy consoles and controllers. | planned |
| **OPC** | Dead-simple, creative-coding/DIY (FadeCandy lineage). | maybe |

## Where voxeled sits

| | **voxeled** | xLights | MADRIX 5 | LX / Chromatik |
|---|---|---|---|---|
| Render space | native 3D point cloud | 2D buffer → projected | 3D voxel matrix | 3D point cloud |
| Real-world-unit patterns | ✅ core | partial | grid / voxel | ✅ |
| Open + cross-platform | ✅ MIT | ✅ open source | ❌ Windows, dongle | ✅ (but monolithic) |
| Embeddable / API-first | ✅ hub + bus | build-pipeline API | ❌ | ❌ (drive via OSC) |
| Imports glTF / GDTF / MVR | planned | ❌ | ❌ | ❌ (own `.lxf`) |
| Camera automapping | planned, built-in | 3rd-party workflow | ❌ | ❌ |

*(Comparison is about fit for this niche, not overall quality — these are all good tools.)*

## The north star: camera automapping & dynamic scenes

Two differentiators the incumbents leave open:

- **Built-in camera automapper.** Stop hand-placing thousands of pixels. Light them in a **Gray-code** sequence, detect each in a camera frame, and **triangulate** across ≥2 views into a real 3D point cloud (single camera → 2D map). Strong prior art (aaknitt/pixel_mapper, Lightwork) but no polished, integrated product.
- **Dynamic scenes.** Positions that update *live* — from camera tracking or from MVR-xchange feeding CAD position changes over the network — so a moving rig re-maps continuously. Today's tools do a one-time static scan; nothing does this well.

## Roadmap

- **Phase 0 — the spine** *(now)*: minimal scene format → hub loads it → one spatial pattern → normalized bus → WebGL preview + DDP/Art-Net sender, on one strip. Preview and reality visibly match.
- **Phase 1 — bring your geometry**: glTF/USD import; a Blender plugin that bakes per-instance **positions + normals** via Geometry Nodes; then GDTF/MVR import.
- **Phase 2 — automap**: Gray-code structured-light camera mapper, multi-view triangulation, export to native + glTF.
- **Phase 3 — live**: dynamic scenes (live re-localization / MVR-xchange), DAW-style channels + modulators (LFOs / envelopes / audio), scenes & crossfades.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design notes and the reasoning behind these decisions.

## Design principles

1. **Open by default** — MIT, cross-platform, no dongles, no lock-in.
2. **Interoperate, don't imprison** — import the standards; keep your own file the source of truth.
3. **3D is native**, not a projection of a 2D buffer.
4. **Space over index** — patterns are spatial functions in real-world units.
5. **Preview == output** — the same frames drive the visualizer and the fixtures.
6. **An ecosystem of small parts**, not a monolith.

## Contributing

Very early — issues, ideas, and prior-art pointers are welcome while the spine takes shape. If you've fought the CAD-model → LED-points-with-correct-normals problem, or camera automapping, come say hi in the issues.

## License

[MIT](LICENSE) © Dan Newcome
