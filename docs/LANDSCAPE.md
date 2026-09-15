# The LED-control landscape — and where voxeled sits

"LED software" is not one market. It is five or six different tiers that share protocols and
almost nothing else. Placing voxeled honestly means naming each tier, what it is actually *for*,
and which of its assumptions voxeled keeps or breaks.

The short version: **voxeled is not a sequencer, a console, or a media server.** It is the piece's
*map* — position **and emission direction** for every LED, plus the wiring — and a hub that any of
those tools can perform through. The tiers below either lack the map (they keep points, not
oriented emitters), lock it inside their product, or are not built for a sculpture at all.

## 1. Holiday / hobby sequencers — xLights, Vixen, Light-O-Rama, FPP

**Built for:** a house at Christmas. One person, one timeline, one music track, a few thousand
pixels on cheap controllers (Falcon, Kulp, HinksPix, WLED nodes) over E1.31/DDP.

- **xLights** (open, C++) is the strongest of these and the one most worth learning from. It has a
  real *model library* — Matrix, Tree, Arches, Candy Canes, Spinner, Poly Line, Custom grid — a 3D
  layout with `WorldPos/Rotate/Scale`, an OBJ mesh of the house as a "view object", a controller
  visualizer that maps models onto ports/universes, and a mature timeline of effects rendered into
  each model's *2D buffer* and draped onto its geometry. Thousands of installations exist in its
  `xlights_rgbeffects.xml`.
- **Vixen** (open, .NET) and **LOR** (commercial) are the same shape with smaller model systems.
- **FPP — Falcon Player** is the *runtime* half: a Pi/BeagleBone that plays xLights sequences on a
  schedule, syncs several players, and bridges E1.31/DDP to pixel ports. Rock-solid, not creative.

**What they are not:** show control. There are no cue stacks, no SMPTE/MTC timecode as a first-class
clock (FPP can follow it via plugins), no OSC/MIDI surfaces, no sACN priority/merge, no redundancy.
Geometry is 2.5D — a buffer projected onto a shape; no LED has an orientation, the house mesh is
decoration, not an occluder. Content authoring lives *inside* the tool; nothing performs *through*
it.

**Relation to voxeled:** the best UX reference for layout + patch, and an install base. xLights
already speaks DDP, so it can drive voxeled as a DDP Display today (sequence in xLights, see it with
lobes and occlusion in voxeled, fan out to any protocol). An `xlights_rgbeffects.xml` importer
(evaluate the built-in `DisplayAs` types, assign normals, carry the controller patch into
`output`, pull view objects in as structures) is the natural next on-ramp after `.lxm`.

## 2. Art-piece / generative engines — Chromatik (LX Studio), Pixelblaze, WLED, LedFx, FastLED

**Built for:** sculptures, playa art, installations where the pattern *is* the art.

- **Chromatik / LX Studio** (open, Java) gets the *idea* right: pixels as a positioned 3D point
  cloud, patterns as spatial functions, DAW-style channels, modulators and blending, a fixture
  format (`.lxf`) with expressions, OSC/MIDI in. It is the closest thing to a volumetric "house
  system" that exists — and it is a monolith: patterns are Java classes compiled into the app, the
  model lives in its own JSON, points carry no normals, the 3D view is flat dots, and other tools
  reach it only through OSC. ([interop/lxm.md](interop/lxm.md) documents the format; voxeled
  imports it and adds the normals LX discards.)
- **Pixelblaze** puts a JS pattern engine on the controller itself, with a mapper (including a
  camera-assisted one) that gives each pixel 2D/3D coordinates. Brilliant for one strip-scale
  object; no multi-fixture world, no orientation, no patch beyond its own outputs.
- **WLED** is the ESP firmware everyone runs: rich on-device 1D/2D effects, a phone UI, DDP/E1.31 in.
  It is an *endpoint*, not a map.
- **LedFx** is audio-reactive effects fanned out to WLED/DDP devices; 1D per device.
- **FastLED / Processing / openFrameworks / three.js one-offs** — what most artists actually ship:
  a bespoke program per piece, with the geometry hard-coded. voxeled exists because the author kept
  writing these.

**Relation to voxeled:** same audience, same openness, same "patterns are functions of position"
core. The difference is what the map *is* (oriented emitters, not points), that geometry comes
from CAD/Blender/Grasshopper instead of hand-typed lists, that the piece can be simulated as it will
look, and that voxeled is designed to be performed *through* rather than to own the pattern
language. Chromatik's channel/modulator UX remains something to learn from, not compete with.

## 3. Real-time engines used as pixel sources — TouchDesigner, Notch, Unreal/Unity, Resolume, TiXL

**Built for:** VJs, stage visuals, generative artists — content as a live signal.

- **TouchDesigner** is natively 3D (SOP geometry, instancing) and has DMX Out; many art pieces are
  driven by a TD network sampling a point cloud into Art-Net. **Notch** and **Unreal** (whose DMX
  plugin imports **GDTF/MVR**) do the same at the high end. **TiXL** is the open, node-based
  sibling. **Resolume Arena** adds DMX/Art-Net fixture output (its Lumiverse fixture editor) so a
  video wall and a pixel-mapped truss run off the same layer stack.
- Every one of them needs to be told *where the pixels are*, in its own way, and none of them owns
  the wire well: universe math, per-fixture byte order, mixed protocols, unicast lists are an
  afterthought.

**Relation to voxeled:** these are the **jack-in** — the tools people already perform in. voxeled
gives them the map (glTF export, the TiXL `LoadVoxeledScene` op) and takes their frames back
(TCP colour input, DDP Display), then handles the patch. This is exactly the house-system model:
NDI/Resolume for screens, voxeled for volumes.

## 4. Pro media servers & pixel-mapping suites — MADRIX, Madmapper, ENTTEC ELM, Hippotizer, disguise, Pixera, ArKaos

**Built for:** rental & staging, architectural and retail installs, festival stages. Paid, Windows/
macOS, often dongled, sold per-universe or per-output.

- **MADRIX 5** is the reference for true *volumetric* rendering: a 3D voxel space, fixtures placed
  in X/Y/Z in its Patch Editor, Art-Net/sACN/KiNET/DVI out, scripting. Windows-only, closed, priced
  by channel via USB dongle. Its voxel space is *effects in a volume sampled at fixtures* — no
  per-LED orientation or occlusion, no CAD on-ramp.
- **Madmapper** is 2D projection-mapping first with a pixel-mapping module and **MadLight** — a
  camera-based LED scanner that finds each pixel by flashing it. The closest shipping thing to
  voxeled's planned automapper (2D).
- **ENTTEC ELM**, **Lightjams**, **ArKaos MediaMaster (Kling-Net)**, and the pixel-mapper modules
  of **Hippotizer / disguise / Pixera** map *video* onto 2D fixture layouts and output DMX. Robust,
  well-patched, flat.

**Relation to voxeled:** these own the patch and the reliability story voxeled still has to earn
(see §7). They do not own geometry beyond a 2D canvas or a voxel grid, they are not open, and
nothing external performs through them except as a video input. voxeled's lane is the one they
leave open: an open, geometry-first, orientation-aware map with a serious patch.

## 5. Lighting consoles & previz — grandMA3, ETC Eos, ChamSys MagicQ, Onyx · Capture, Depence, Vision, WYSIWYG, L8

**Built for:** theatre, touring, broadcast — *show control* in the strict sense: cue lists,
timecode, tracking, priorities, merges, backups, a programmer at a desk.

- Consoles treat LED pixels as **fixtures** (via **GDTF**) placed in a **3D stage** (via **MVR**),
  with pixel-map/bitmap effects layered on top. Geometry is real, units are real, and — unlike every
  tier above — a fixture has an *orientation* and a *beam*: GDTF's `Beam` geometry carries the
  emission direction and angle. This is the pro world's version of voxeled's normal.
- **Visualizers** (Capture, Depence, Vision, WYSIWYG, L8, BlenderDMX) render those fixtures
  photoreally, beams and all, from the same GDTF/MVR data.

**Relation to voxeled:** the same *model* — fixtures with placement and emission direction — from
the opposite end of the price scale. Consoles are the wrong tool for a 7,000-LED sculpture with a
generative pattern (they think in channels and cues, not spatial functions), but their interchange
formats are the right destination: GDTF/MVR import/export is on the roadmap precisely so a voxeled
piece can be dropped into a grandMA3 show file or a Capture previz.

## 6. Hardware — controllers and firmware

Falcon, Kulp, Advatek PixLite, HinksPix, WLED/ESP32 nodes, Teensy/FastLED, PixelPusher, Fadecandy
(OPC), KiNET power supplies, the author's own dan-mx ESP32 nodes. These are the *endpoints*: they
accept E1.31/Art-Net/DDP/KiNET/OPC/dan-mx and drive wire. voxeled treats them as targets in the
patch, one protocol per fixture as needed ([interop/protocols.md](interop/protocols.md)).

## 7. Where voxeled sits

| | hobby sequencers | art engines | real-time engines | media servers | consoles / previz | **voxeled** |
|---|---|---|---|---|---|---|
| geometry | 2.5D models | 3D points | 3D, per tool | 2D canvas / voxel grid | 3D fixtures (MVR) | **3D oriented emitters** |
| LED orientation | — | — | — | — | GDTF beam | **normal per LED, core** |
| appearance sim (lobe · backside · occlusion) | — | — | (you build it) | — | beams, photoreal | **yes, from the map** |
| geometry on-ramp | built-in primitives | hand-typed / camera | import per tool | canvas placement | GDTF/MVR/CAD | **CAD chips · Blender · Grasshopper · glTF · LX · ropes** |
| patch (mixed protocols, byte order, universes) | good | per-tool outputs | weak | excellent | excellent | good — Art-Net · DDP · dan-mx, per fixture |
| other tools perform through it | — | OSC | *they* are the performer | video in | — | **yes: TCP, DDP in, phone; glTF out** |
| show control (cues, timecode, priority, failover) | — | modulators, OSC | — | some | **yes** | **not yet** |
| open | ✅ | ✅ | mixed | ❌ | ❌ | ✅ MIT |

So: voxeled is the **open house system for an LED piece** — the layer between *how the piece is
built* (CAD, Blender, Grasshopper, the steel) and *how it is performed* (TiXL, TouchDesigner,
Resolume, a phone, its own patterns) — owning the two things nobody else owns openly: the
orientation-aware map and the patch. It borrows the fixtures-in-a-world model from the pro
world, the spatial-pattern idea from Chromatik, the layout/patch UX ambitions of xLights, and the
openness of all the DIY tools.

### What it is not — yet

Being honest about "pro show control", since none of the open tools are one:

- **No timeline or cue list.** The show is a scene list with crossfades. A cue stack with go/hold,
  chases, and follow-ons is the obvious next layer above the mixer.
- **No timecode.** SMPTE/LTC, MTC, or a network clock (Art-Net timecode, OSC `/time`) should be
  able to *drive* the show so voxeled locks to a production's master.
- **No OSC / MIDI surface.** The `/control` seam takes HTTP today; OSC in (and out, for feedback)
  is what a console, QLab, or a MIDI controller expects.
- **No sACN priority / merging, no failover.** A pro rig runs a backup source; sACN priority and
  HTP/LTP merge decide who wins. Also a watchdog "hold last frame / fallback show" on input loss.
- **No output redundancy or health.** Per-node liveness, RDM/DDP status queries surfaced in the UI.

None of these conflict with the design — they sit on the hub's control seam and the mixer — and the
jack-in model means voxeled can also simply *be driven* by a real console (sACN/Art-Net in, or
timecode) while it keeps owning the map and the patch.
