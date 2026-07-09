# Visibility — the virtual camera over the map

The deepest thing voxeled knows about a piece isn't where each LED is, or which way it faces — it's
**whether that LED is actually seen from a given vantage.** A bare point cloud (Chromatik) can't ask
this; it threw the orientation away and never had the geometry-as-a-solid to occlude with. This is
voxeled's level-3 space-awareness, and it's exactly what the [Thread](https://github.com/dnewcome/thread-3d)
sculpture needed: *"the LED strips would come in and out of view depending on the camera position."*

## Three levels

1. **Position** — `f(x,y,z,t)`. Spatial, but blind to how light leaves the piece. (Everyone.)
2. **+ Orientation** — respect each LED's emission normal: front-face looks, surface flow, view-angle
   falloff. (voxeled's normal.)
3. **+ Visibility** — respect what's actually *seen* from a vantage: self-occlusion, silhouette,
   "which strands read from where the audience stands." (This module.)

## One primitive, three uses

All three are the same operation — *project the map through a camera and z-test* — read differently:

| use | what it is | in voxeled |
|---|---|---|
| **occlusion / facing** | light only what the audience sees | `patterns.spotlight` |
| **projection-mapping** | sample a 2D frame onto the visible surface | `patterns.projector` / `projectTexture` |
| **camera automapping** | the *inverse*: recover positions from where LEDs land in a real camera | future (same math) |

That collapse is the point: build the virtual camera once and occlusion, the VJ framebuffer jack-in,
and camera automapping all fall out of it.

## The primitive (`src/visibility.mjs`)

- **`lookAt({eye, target, up, fovDeg, aspect})`** — a pinhole camera (orthonormal basis + params).
- **`project(cam, p)`** → `{ depth, u, v, inFrustum }` — a world point's depth along the view and its
  screen uv in `[0,1]²`.
- **`facing(cam, p, n)`** — cosine of the emission normal against the direction to the eye; `>0` faces
  the camera.
- **`computeVisibility(scene, cam, opts)`** → per pixel `{ uv, depth, facing, visible }`. Occlusion is
  a **depth buffer**: every front-facing point splats its depth into an image grid; a point is hidden
  if something nearer occupies its cell, beyond a depth tolerance (a couple of LED pitches) so
  co-surface points don't occlude each other. Knobs: `width`/`height` (grid), `splat` (point
  footprint), `backface`, `depthTolMM`/`relEps`.
- **`projectTexture(scene, cam, sample, opts)`** — colour each visible pixel by `sample(u,v)`; occluded
  pixels get `off`. This *is* projection-mapping / the VJ jack-in, read the other way.
- **`frameCamera(scene, {angleDeg, elevDeg, fovDeg})`** — auto-frame any scene's bounds at an orbit
  angle, so the patterns need no hand-placed coordinates.

It's dependency-free, deterministic, and cheap: ~1.9 ms/frame over the 9 216-point two-heart rig
(≈500 fps) — a whole-scene depth pass cached once per frame (`ctx.frame`), so per-pixel patterns just
read the result.

## See it

```bash
VOX_PATTERN=spotlight node examples/mobius-heart/run.mjs   # occlusion: LEDs wink in/out as it orbits
VOX_PATTERN=projector node examples/mobius-heart/run.mjs   # a texture projected onto the visible surface
```

`spotlight` lights only the camera-visible, front-facing pixels (grazing angles dimmer) as the
vantage orbits — the Thread "in and out of view" effect, computed instead of hand-managed.
`projector` maps a scrolling band through the same camera onto the piece, occlusion respected — a
preview of a VJ jacking a framebuffer into the house.

## Limits / next

- The depth buffer is resolution- and `splat`-dependent (like any point-cloud visibility); the
  defaults suit LED-pitch geometry. Very sparse or very dense rigs may want `res`/`splat`/`depthTolMM`
  tuned.
- Today the vantage lives in the pattern. A natural next step is a scene-level viewpoint exposed to
  *any* pattern (`ctx.visibleFrom(cam)`), so occlusion-awareness composes with existing looks — and
  then the same camera, inverted, becomes the automapper.
