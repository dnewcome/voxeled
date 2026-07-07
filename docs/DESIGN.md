# voxeled — design notes

Living record of the decisions behind voxeled and the reasoning that produced them. Started from a kickoff conversation on 2026-07-07.

## Kickoff brief

- **Problem:** Volumetric LED tools are either monolithic and painful to integrate (LX Studio / Chromatik — Java patterns, awkward geometry import, no interchange) or closed and dongle-locked (MADRIX). None pair real-world-unit spatial animation with open, integration-friendly geometry + protocol interchange.
- **Done looks like:** A running hub loads a pixel-first scene (points carrying position + normal + output address), runs **one** world-space pattern, and fans **identical** frames to a WebGL preview *and* a real strip over DDP/Art-Net — preview and reality visibly match.
- **Not now:** Camera automapping, dynamic/moving-scene re-localization, full GDTF/MVR import, the Blender plugin, DAW-style UI, multiple visualizers. All roadmap — none in slice one.
- **First slice:** The spine, proven end-to-end and deliberately tiny — minimal format → hub loads it → one spatial pattern (uses XYZ so the real-world-unit value is visible) → normalized bus → WebSocket→WebGL viewer **and** DDP/Art-Net sender, on one hand-authored strip.
- **Open question:** CAD→points-with-normals (below). Riskiest *later* unknown is the **dynamic** scene — nothing in the space does live re-localization well, which is also where the differentiation lives.

## Decisions

1. **Spine = live hub + normalized pixel bus.** One process holds the scene, runs the pattern engine, and fans identical frames to every consumer. Preview and output are literally the same frames. Chosen over "format-first toolkit" and "browser-native engine" because it's the durable center for a live show and the format falls out of what the hub needs to load.
2. **Own a pixel-first scene format, import the standards.** A small, versioned, addressable-LED-tuned format (TOML/JSON) is the source of truth. Importers pull in glTF/USD (meshes) and GDTF/MVR (pro fixtures + rigs, positions already in mm). Reject GDTF as the *native* format — it's DMX-moving-light-centric and verbose for hundreds of pixels per fixture — but embrace it as an import target.
3. **3D point cloud is the native render space.** Every pixel is a positioned point with a normal; patterns are spatial functions `f(x, y, z, t) → color`. Not a 2D buffer projected onto geometry (xLights' model). Validated by MADRIX (voxels) and Chromatik ("sparse vertex shader").
4. **Real-world units (mm) throughout.** The one thing worth keeping from LX Studio: animation that reads smoothly across irregularly-spaced fixtures because motion is defined in physical space, not pixel index.
5. **DDP-first transport,** then sACN and Art-Net. DDP's offset-addressed flat framebuffer avoids 512-channel universe fragmentation and the ~44 Hz DMX refresh cap — the pragmatic winner for high pixel counts. sACN for pro/console interop (multicast + priority); Art-Net for reach.
6. **Ecosystem of small parts, not a monolith.** WebGL visualizers, Blender plugins, senders/sinks, network glue — each a client of the bus or an emitter of a scene. This is the wedge against every incumbent: integration-friendliness.
7. **Open + cross-platform, MIT, no dongle.** MADRIX's dongle/per-channel licensing and the Windows-only tools leave a wide-open lane.

## The CAD → LED-points-with-normals problem

The recurring blocker: turning a CAD model into positioned LED points *with a correct emission normal* (which way each light points). Needed so patterns can do dot-product-with-direction effects and so visualizers shade correctly.

### Why it's hard (grounded in thread-3d)

[thread-3d](https://github.com/dnewcome/thread-3d) extracts LED positions from an STL by averaging triangle centroids per LED group. It works for positions but yields **no per-LED normal** — and the LEDs ride a **swept tube**, whose triangle face normals point radially in every direction around the tube. Average them over one LED's triangle group and they **cancel toward zero**. That is the crux: sampling the raw CAD tube surface is the wrong source for "which way does the light point."

CAD exports also routinely ship **flipped/inconsistent winding**, so any surface-derived normal needs a normalize-and-repair pass regardless of source.

### The right sources for a normal

1. **The form surface, not the strip's tube.** For LEDs wrapped onto a sculpture/form, the emission normal you actually want is **outward from the form surface** at each point — raycast/nearest-face against the *form* mesh (or the medial reference), not the swept tube that carries the strip. This is the fix for the thread-3d case specifically.
2. **Blender bakes it for you (preferred authoring path).** Place LEDs with Geometry Nodes → *Distribute Points on Faces* (or instance-on-points), and each instance carries the interpolated **surface normal for free** — position *and* direction in one step, no separate solve. Bake `position + normal` into point attributes and export. This makes the Blender plugin the geometry authority.
3. **Strip gotcha:** for addressable strips the LEDs point *perpendicular to the mounting surface*, which is **not** the strip's travel direction. A curve-only import gives tangents, not emission normals — you still need the mounting surface (or an explicit "up") to get the real direction.
4. **Point-cloud fallback** (e.g. output of the camera automapper, or a surfaceless dump): estimate normals from k-nearest-neighbors (PCA, normal = smallest-eigenvector plane fit), then **orient consistently** — propagate orientation across the kNN graph, or raycast outward and flip any normal that re-enters the mesh. Standard Open3D `estimate_normals` + `orient_normals_consistent_tangent_plane`.

### Format implication

`normal` is a **first-class field on every pixel** (`position + normal + address`, minimum), carried through glTF as the standard `NORMAL` vertex attribute / USD `normals` primvar so it survives round-trips. Metadata is the first casualty of format conversion, so voxeled's own file stays the source of truth; glTF/USD are carriers.

## Interchange formats — stance

| Format | Role in voxeled |
|---|---|
| **native `.vxl`** (TOML/JSON) | Source of truth: geometry + per-output addressing + user params, co-located (Chromatik's best idea), versioned + stable. |
| **glTF / GLB** | Primary mesh interchange; `extras` + custom vertex attrs (`NORMAL`, index) carry LED metadata. Import + export. |
| **USD / USDZ** | For very large / instanced scenes — `PointInstancer` scales to millions of points with per-point attributes. |
| **GDTF** | Import target — the open fixture-definition XML standard (grandMA3, Vectorworks, Capture, Depence, BlenderDMX). Not native. |
| **MVR** | Import target — packages GDTF fixtures + placement + patch, **positions in mm**. MVR-xchange (mDNS + WebSocket) could feed *live* position updates → directly relevant to dynamic scenes. |
| **OFL JSON** | Reference model + importable data source only; its internal schema is explicitly unstable — do not build on it. |

## Protocols

| Protocol | Model | voxeled |
|---|---|---|
| **DDP** | UDP, offset into flat framebuffer, push flag, discovery. No universe fragmentation, no refresh cap. | **primary** |
| **sACN / E1.31** | UDP multicast, 512-ch universes + priority. | planned |
| **Art-Net** | UDP, 512-ch universes, broad reach. | planned |
| **OPC** | TCP, dead-simple `[channel, cmd, len, data]`. | maybe |

## Roadmap

- **Phase 0 — the spine** *(now)*: minimal `.vxl` → hub loads it → one spatial pattern → normalized bus → WebGL preview (WebSocket) + DDP/Art-Net sender, one strip. Preview == reality.
- **Phase 1 — bring your geometry**: glTF/USD import; Blender plugin baking positions + normals via Geometry Nodes; then GDTF/MVR import.
- **Phase 2 — automap**: Gray-code structured-light camera mapper (light pixels in a binary-coded sequence, detect per frame, triangulate ≥2 views → 3D; single camera → 2D). Export to native + glTF. Prior art: aaknitt/pixel_mapper, PWRFLcreative/Lightwork.
- **Phase 3 — live**: dynamic scenes (live re-localization via camera tracking or MVR-xchange), DAW-style channels + modulators (LFOs / envelopes / audio), scenes & crossfades.

## Prior art surveyed

- **xLights** — open C++ sequencer; Model/submodel/group system; render-buffer-style maps effects onto geometry but is 2D-buffer-first; `.xmodel`/`.xsq`/`.fseq` (clean author/play split); E1.31/Art-Net/DDP/ZCPP; FPP runtime; REST automation aimed at the build pipeline. *Learn:* author/play split, controller auto-addressing, submodels/groups. *Avoid:* 2D-buffer mental model, closed C++ effects.
- **MADRIX 5** — the reference for true voxel/volumetric rendering; Patch Editor places fixtures in X/Y/Z; Art-Net/sACN/KiNET/DVI; MAS scripting. *Avoid:* Windows-only, dongle + per-channel licensing, no open interchange.
- **Jinx!** (live-leds.de) — free Windows LED-matrix tool; generators + regions + layer merge + scenes; Art-Net/sACN/TPM2/Glediator. *Learn:* compact live generator/merge model, cheap-protocol reach. *Avoid:* 2D-only, Windows-only.
- **LX Studio / Chromatik** — the right *core* (positioned 3D point cloud, spatial patterns, DAW/modular-synth UX) trapped in a monolithic Java app; `.lxf` co-locates geometry + protocol output + params (excellent), but it's LX-specific and patterns compile against the app. *Learn:* the engine model and `.lxf`'s co-location idea. *Avoid:* the monolith; ship an embeddable engine + headless server with a real API, scripting-layer patterns, and standard-format round-tripping.

Sources and the full research brief live in the project history; key format specs: gdtf.eu/gdtf/file-spec, github.com/mvrdevelopment/spec, chromatik.co/guide/custom-fixtures, manual.xlights.org.
