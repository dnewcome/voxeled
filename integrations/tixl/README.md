# voxeled → TiXL

Two operators bridge voxeled and TiXL — voxeled's map stays the source of truth for geometry **and**
wiring; TiXL supplies the look:

- **`LoadVoxeledScene`** — import a `.vxl.json` scene as TiXL **Points** (world position +
  emission-normal orientation), to visualize/animate the map inside TiXL. ✅ confirmed rendering on
  TiXL 4.1 under Wine.
- **`VoxeledOutput`** — stream the colored points back to a running voxeled, which applies the
  scene's protocol patch (Art-Net + dan-mx + DDP + custom). TiXL never has to know the protocols.

## Install (hand-authored operator)

Copy the three files into your TiXL user package (they belong to the `dan.MyProject` package):

```bash
cp LoadVoxeledScene.* VoxeledOutput.* ~/Documents/TiXL/MyProject/
```

Start (or, if running, just refocus) TiXL — it recompiles the package and hot-reloads. The operator
appears as **LoadVoxeledScene** (namespace `dan.MyProject`). It targets `net9.0` + SharpDX, matching
the package's `.csproj`; all T3/SharpDX types it uses are already global-aliased there (only
`System.Text.Json` is imported explicitly).

## Use

1. Export a scene from voxeled: `make export LAYOUT=examples/mobius-heart/layouts/two-hearts.yaml`
   → `build/two-hearts.vxl.json`.
2. Point the operator at it: set **FilePath** (file-picker, or paste a path — a Unix `/home/…` path
   is auto-translated to Wine's `Z:` drive), **or** leave it empty and set the **`VOXELED_SCENE`**
   env var (`run-tixl.sh` does this for you).
3. **See it:** wire **`Points → DrawPoints`**, then **`DrawPoints.Output → OrbitCamera`**; select the
   camera and press **F**. On `DrawPoints` set **`UsePointsScale = false`** and **`PointSize ≈ 0.2`**
   (see Gotchas). Two heart point-clouds appear. ✅ confirmed working.
4. **Drive fixtures:** wire **`Points → PointsToDmxLights → ArtnetOutput`** for Art-Net, or (soon)
   `VoxeledOutput` to hand colored points back to voxeled for the full mixed-protocol patch.

Knobs: **ScaleToUnits** `0.001` (voxeled mm → TiXL metres) · **PointSize** (per-point scale) ·
**FixtureIndex** (−1 = all; ≥0 = only that fixture).

### Drive the sculpture from TiXL (`VoxeledOutput`)

Color the imported points with your TiXL look, then hand them back to voxeled to light the real
fixtures — voxeled applies the scene's patch, so mixed/custom protocols stay in one place.

1. Run voxeled in **listen mode**: `VOX_LISTEN=9600 node examples/mobius-heart/run.mjs <layout>`
   (e.g. the `patched.yaml` mixed-protocol rig). It pauses the internal show and drives the fixtures
   **and** browser preview from incoming frames.
2. In TiXL, wire your colored **`Points → VoxeledOutput`** and set **Host**/**Port** to match
   (default `127.0.0.1:9600`).
3. voxeled receives the RGB frame (scene order) and fans it out per the patch — Art-Net + dan-mx +
   DDP, all at once.

Wire format: length-prefixed RGB frames over TCP. Points must be in **scene order**
(`LoadVoxeledScene` → color ops that preserve order → `VoxeledOutput`).

### Grouping points into fixtures

The scene tags every pixel with its instance; the operator surfaces that two ways:

- **`FixtureIndex`** input — `−1` loads all fixtures; `0,1,2,…` loads just one fixture's points (e.g.
  a single heart). Drop several `LoadVoxeledScene` ops, one per index, for per-fixture graphs.
- **`F2` channel** — every point carries its fixture index in `F2`, so `FilterPoints` / `SelectPoints`
  (on F2) split one buffer into fixtures downstream.

## Launch (Wine)

TiXL and its .NET runtime live in the **`~/.wine-tixl`** prefix. A bare `wine TiXL.exe` uses the
default `~/.wine` prefix (no .NET) and fails with *"You must install .NET"*. Launch with the prefix
and .NET location set — or use the bundled script, which also rebuilds the operator first:

```bash
./run-tixl.sh                     # rebuild MyProject, then launch TiXL
# …or manually:
cd ~/.wine-tixl/drive_c/Program\ Files/TiXL/TiXL\ 4.1.0.9-alpha
WINEPREFIX=~/.wine-tixl DOTNET_ROOT='C:\Program Files\dotnet' wine TiXL.exe
```

## Rebuild / reload

TiXL loads a package's **prebuilt DLL and does *not* recompile on startup**, so a freshly-copied
`.cs` won't appear until the DLL is rebuilt. Rebuild it (this also compile-checks the operator),
then **restart TiXL**:

```bash
WINEPREFIX=~/.wine-tixl T3_ASSEMBLY_PATH='C:\Program Files\TiXL\TiXL 4.1.0.9-alpha' \
  wine 'C:\Program Files\dotnet\dotnet.exe' build 'Z:\home\dan\Documents\TiXL\MyProject\MyProject.csproj' -c Debug
```

(Alternatively, edit + save the `.cs` from *inside* TiXL to trigger its own hot-recompile.)

## Gotchas (learned during bring-up)

- **`DrawPoints` → `UsePointsScale = false`** to be visible — with it on, DrawPoints multiplies by
  each point's small `Scale` and the dots vanish.
- **Paths are Wine paths** — TiXL's .NET reads `/home/…` as `C:\home\…`; the operator auto-converts a
  leading `/` to the `Z:` drive, so either form works.
- **A "red" operator / log error is likely NOT yours** — this install ships a broken `Mediapipe`
  example package (`Google.Protobuf` missing) that logs type-load errors; unrelated to `dan.MyProject`.
- **Pull-based** — the operator only loads when something downstream (a viewed camera) requests its
  output.

## Notes / status

- Both operators **compile clean** (0/0, verified via `wine dotnet build`; the DLL contains
  `LoadVoxeledScene` + `VoxeledOutput`). `LoadVoxeledScene` is **confirmed rendering** in TiXL 4.1;
  `VoxeledOutput` is verified against the voxeled TCP receiver (`test/color-input.test.mjs`) — try it
  live in your TiXL graph.
- **GUIDs are stable** — don't change them; the `.t3`/`.t3ui` are keyed to them.
- The operator **caches its GPU buffer** (keyed on path/scale/size/fixture) — no per-frame rebuild;
  it logs `voxeled: loaded N points …` once per (re)load.
- **FilePath** has a file-picker (`IDescriptiveFilename`) and a **`VOXELED_SCENE`** env fallback.
