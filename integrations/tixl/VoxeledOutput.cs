using System.Net.Sockets; // not in the package's global usings

#pragma warning disable CA1416 // T3 types carry [SupportedOSPlatform("windows")]; TiXL runs on Windows/Wine.

namespace dan.MyProject;

// VoxeledOutput — the "drive from TiXL" half of the bridge. Reads the colour of each point back from
// the GPU and streams the RGB frame (in scene order) over TCP to a running voxeled instance, which
// applies the scene's patch (Art-Net + dan-mx + DDP + custom). voxeled owns the protocols; TiXL just
// sends colours. Run voxeled with VOX_LISTEN=<port>, then wire your coloured Points into this op.
//
// Note: expects the points in scene order (LoadVoxeledScene → colour ops that preserve order → here).
[Guid("b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b40")]
public sealed class VoxeledOutput : Instance<VoxeledOutput>
{
    // Command output → evaluated every frame (this is a side-effect sink).
    [Output(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b41", DirtyFlagTrigger = DirtyFlagTrigger.Animated)]
    public readonly Slot<Command> Output = new();

    public VoxeledOutput()
    {
        Output.UpdateAction += Update;
    }

    private readonly StructuredBufferReadAccess _reader = new();
    private Point[] _points = Array.Empty<Point>();
    private byte[] _frame = Array.Empty<byte>(); // [4-byte BE length][RGB per point]
    private TcpClient? _client;
    private NetworkStream? _stream;
    private string _host = "127.0.0.1";
    private int _port = 9600;
    private long _nextRetryMs;

    private void Update(EvaluationContext context)
    {
        Output.Value = new Command();
        if (!Enabled.GetValue(context)) return;

        var pts = Points.GetValue(context);
        if (pts?.Buffer == null || pts.Srv == null) return;

        _host = Host.GetValue(context) ?? "127.0.0.1";
        _port = Port.GetValue(context);

        // Async GPU→CPU readback; OnRead fires a couple frames later with the point data.
        _reader.InitiateRead(pts.Buffer, pts.Srv.Description.Buffer.ElementCount, pts.Buffer.Description.StructureByteStride, OnRead);
        _reader.Update();
    }

    private void OnRead(StructuredBufferReadAccess.ReadRequestItem item, IntPtr _, SharpDX.DataStream stream)
    {
        var count = item.ElementCount;
        if (_points.Length != count) _points = new Point[count];
        using (stream) stream.ReadRange(_points, 0, count);

        var payload = count * 3;
        if (_frame.Length != 4 + payload) _frame = new byte[4 + payload];
        _frame[0] = (byte)(payload >> 24);
        _frame[1] = (byte)(payload >> 16);
        _frame[2] = (byte)(payload >> 8);
        _frame[3] = (byte)payload;
        for (var i = 0; i < count; i++)
        {
            var c = _points[i].Color;
            _frame[4 + i * 3] = ToByte(c.X);
            _frame[4 + i * 3 + 1] = ToByte(c.Y);
            _frame[4 + i * 3 + 2] = ToByte(c.Z);
        }
        Send(_frame);
    }

    private static byte ToByte(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255f), 0, 255);

    private void Send(byte[] data)
    {
        try
        {
            if (_stream == null || !(_client?.Connected ?? false))
                if (!TryConnect()) return;
            _stream!.Write(data, 0, data.Length);
        }
        catch
        {
            Drop();
        }
    }

    private bool TryConnect()
    {
        var now = Environment.TickCount64;
        if (now < _nextRetryMs) return false; // don't hammer a dead host every frame
        _nextRetryMs = now + 1000;
        try
        {
            _client = new TcpClient { NoDelay = true };
            _client.Connect(_host, _port);
            _stream = _client.GetStream();
            Log.Info($"voxeled: connected to {_host}:{_port}", this);
            return true;
        }
        catch (Exception e)
        {
            Log.Warning($"voxeled: can't reach {_host}:{_port} — {e.Message}", this);
            Drop();
            return false;
        }
    }

    private void Drop()
    {
        try { _stream?.Dispose(); } catch { }
        try { _client?.Dispose(); } catch { }
        _stream = null;
        _client = null;
    }

    protected override void Dispose(bool isDisposing)
    {
        if (isDisposing) Drop();
    }

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b42")]
    public readonly InputSlot<BufferWithViews> Points = new();

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b43")]
    public readonly InputSlot<string> Host = new("127.0.0.1");

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b44")]
    public readonly InputSlot<int> Port = new(9600);

    [Input(Guid = "b0f4d2a1-9c3e-4a7b-8d16-2f5e7c9a1b45")]
    public readonly InputSlot<bool> Enabled = new(true);
}
