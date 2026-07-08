# voxeled → TiXL

`LoadVoxeledScene` — a TiXL 4.1 operator that imports a voxeled `.vxl.json` scene as a **Points**
buffer (world position + emission-normal → orientation), so you can visualize and drive your real
installation inside TiXL. **Confirmed working** end-to-end on TiXL 4.1 under Wine — a voxeled scene
renders as points in the TiXL viewport.

This is the *import* half of the bridge. voxeled's map stays the source of truth; TiXL works with
it directly. (The *drive-from-TiXL* half — `VoxeledOutput`, streaming colored points back to a
running voxeled that applies the scene's protocol patch — comes next.)

## Install (hand-authored operator)

Copy the three files into your TiXL user package (they belong to the `dan.MyProject` package):

```bash
cp LoadVoxeledScene.cs LoadVoxeledScene.t3 LoadVoxeledScene.t3ui ~/Documents/TiXL/MyProject/
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

- **Confirmed rendering** in TiXL 4.1 under Wine; compiles clean (0 warnings/errors, verified via the
  `wine dotnet build` above — the DLL contains `LoadVoxeledScene`).
- **GUIDs are stable** — don't change them; the `.t3`/`.t3ui` are keyed to them.
- The operator **caches its GPU buffer** (keyed on path/scale/size/fixture) — no per-frame rebuild;
  it logs `voxeled: loaded N points …` once per (re)load.
- **FilePath** has a file-picker (`IDescriptiveFilename`) and a **`VOXELED_SCENE`** env fallback.
