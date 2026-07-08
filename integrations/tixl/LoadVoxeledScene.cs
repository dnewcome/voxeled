using System.Text.Json; // the only using not already global in the package's .csproj

namespace dan.MyProject;

// Load a voxeled scene (.vxl.json) as a TiXL Points buffer: each LED becomes a Point with its
// world position (scaled to TiXL units) and an orientation derived from its emission normal.
// Wire the output into PointsToDmxLights → ArtnetOutput, or colour the points with your look.
//
// This is the voxeled↔TiXL import bridge. It intentionally does NOT do output — voxeled's map is
// the source of truth; TiXL drives it (or a running voxeled applies the scene's patch).
[Guid("b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b30")]
public sealed class LoadVoxeledScene : Instance<LoadVoxeledScene>
{
    [Output(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b31")]
    public readonly Slot<BufferWithViews> Points = new();

    public LoadVoxeledScene()
    {
        Points.UpdateAction += Update;
    }

    private BufferWithViews? _buffer;

    private void Update(EvaluationContext context)
    {
        var path = FilePath.GetValue(context);
        var scale = ScaleToUnits.GetValue(context);
        var size = PointSize.GetValue(context);

        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            if (!string.IsNullOrWhiteSpace(path))
                Log.Warning($"voxeled: scene file not found: {path}", this);
            Points.Value = null;
            return;
        }

        try
        {
            var points = Parse(File.ReadAllText(path), scale, size);
            if (points.Length == 0)
            {
                Log.Warning($"voxeled: no pixels in {path}", this);
                Points.Value = null;
                return;
            }

            var bw = _buffer ??= new BufferWithViews();
            ResourceManager.SetupStructuredBuffer(points, Point.Stride * points.Length, Point.Stride, ref bw.Buffer);
            ResourceManager.CreateStructuredBufferSrv(bw.Buffer, ref bw.Srv);
            ResourceManager.CreateStructuredBufferUav(bw.Buffer, UnorderedAccessViewBufferFlags.None, ref bw.Uav);
            Points.Value = bw;
            Log.Debug($"voxeled: loaded {points.Length} points from {Path.GetFileName(path)}", this);
        }
        catch (Exception e)
        {
            Log.Warning($"voxeled: failed to load {path}: {e.Message}", this);
            Points.Value = null;
        }
    }

    // Parse a voxeled .vxl.json into Points. Uses only pixels[].p (position, mm) and .n (normal).
    private static Point[] Parse(string json, float scale, float size)
    {
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("pixels", out var pixels) || pixels.ValueKind != JsonValueKind.Array)
            return Array.Empty<Point>();

        var points = new Point[pixels.GetArrayLength()];
        var i = 0;
        foreach (var px in pixels.EnumerateArray())
        {
            var p = px.GetProperty("p");
            var pos = new Vector3((float)p[0].GetDouble(), (float)p[1].GetDouble(), (float)p[2].GetDouble()) * scale;

            var normal = new Vector3(0, 0, 1);
            if (px.TryGetProperty("n", out var n) && n.ValueKind == JsonValueKind.Array && n.GetArrayLength() == 3)
                normal = new Vector3((float)n[0].GetDouble(), (float)n[1].GetDouble(), (float)n[2].GetDouble());

            points[i++] = new Point
            {
                Position = pos,
                Orientation = OrientationFromNormal(normal),
                Color = new Vector4(1, 1, 1, 1),
                Scale = new Vector3(size),
                F1 = 1f,
                F2 = 0f,
            };
        }
        return points;
    }

    // Quaternion that rotates +Z onto the emission normal, so PointsToDmxLights (and the viewport)
    // can recover the direction each LED faces.
    private static Quaternion OrientationFromNormal(Vector3 n)
    {
        if (n.LengthSquared() < 1e-9f)
            return Quaternion.Identity;
        n = Vector3.Normalize(n);
        var z = new Vector3(0, 0, 1);
        var d = Vector3.Dot(z, n);
        if (d > 0.9999f) return Quaternion.Identity;
        if (d < -0.9999f) return Quaternion.CreateFromAxisAngle(new Vector3(1, 0, 0), MathF.PI);
        var axis = Vector3.Normalize(Vector3.Cross(z, n));
        return Quaternion.CreateFromAxisAngle(axis, MathF.Acos(Math.Clamp(d, -1f, 1f)));
    }

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b32")]
    public readonly InputSlot<string> FilePath = new("");

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b33")]
    public readonly InputSlot<float> ScaleToUnits = new(0.001f); // voxeled mm → TiXL units (metres)

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b34")]
    public readonly InputSlot<float> PointSize = new(0.02f);
}
