# voxeled → TiXL

`LoadVoxeledScene` — a TiXL 4.1 operator that imports a voxeled `.vxl.json` scene as a **Points**
buffer (world position + emission-normal → orientation), so you can visualize and drive your real
installation inside TiXL.

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

1. In voxeled, export a scene: `make export LAYOUT=examples/mobius-heart/layouts/two-hearts.yaml`
   → writes `build/two-hearts.vxl.json`.
2. In TiXL, add **LoadVoxeledScene** and set **FilePath** to that file's absolute path.
   - **ScaleToUnits** `0.001` maps voxeled millimetres → TiXL metres.
   - **PointSize** sets the display size stored on each point.
3. Wire **Points** → TiXL's **PointsToDmxLights** → **ArtnetOutput** to drive Art-Net fixtures,
   or run any point/color operators to light them with your look.

## Notes / status

- **GUIDs are stable** — don't change them; the `.t3`/`.t3ui` are keyed to them.
- This was hand-authored and **not compiled here** (no dotnet/TiXL on the authoring machine). If
  TiXL's Log window shows a compile error on reload, paste it back and it's a quick fix. Most
  likely spots: the `Point` struct field set (Position/Orientation/Color/Scale/F1/F2) and the
  `ResourceManager.SetupStructuredBuffer` overload.
- No file-picker yet (plain path field) — paste the absolute path. Adding `IDescriptiveFilename`
  for the picker is a small follow-up.
