# LED transport protocols

voxeled owns the **patch**: every fixture instance's `output` block names a protocol + address, and
`src/output/dispatch.mjs` fans one scene's frames out to all of them at once (Art-Net *and* DDP *and*
dan-mx from the same pixels). This is the reference for what those protocols are and how to patch
them.

The six protocols that show up in this world split into **two families**:

| protocol | family | transport | addressing | colour semantics | voxeled |
|---|---|---|---|---|---|
| **Art-Net** | DMX-over-IP | UDP 6454 | universe + channel (512) | none (8-bit values) | ✅ sender |
| **sACN / E1.31** | DMX-over-IP | UDP 5568 (multicast) | universe + priority | none | mappable¹ |
| **KiNET** | DMX-over-IP | UDP 6038 | port + channel | none | mappable¹ |
| **OPC** | pixel stream | TCP/UDP 7890 | channel + implicit index | none (RGB888) | mappable¹ |
| **DDP** | pixel stream | UDP 4048 | 32-bit **byte** offset | data-type byte | ✅ sender |
| **dan-mx** | pixel stream | UDP | 16-bit **pixel** start + count | colour_space + transfer | ✅ sender |

¹ *mappable* = the LX `.lxm` importer decodes its address fields, and it can be added as a sender or
via `customProtocols` — not yet a built-in sender.

## The two families

- **DMX-over-IP** (Art-Net, sACN, KiNET) comes from the **stage-lighting** world. The unit is a
  512-channel DMX *universe*; you address a fixture by `universe + channel`. Great when a console or
  pro nodes are in the signal path. 8-bit, no colour science.
- **Pixel-streaming** (OPC, DDP, dan-mx) comes from the **LED-art / maker** world. The unit is a
  *framebuffer of RGB*; you address by an offset into it. This is where dense addressable strips and
  sculptural LED live.

## Per protocol

- **Art-Net** — the ubiquitous DMX-over-Ethernet standard; consoles, nodes, and most software speak
  it. voxeled rolls channels across universes automatically (`dispatch.mjs`).
- **sACN (E1.31)** — the other DMX-over-IP standard, multicast with a priority field for backup
  arbitration (`sacnPriority` in the LX patch).
- **KiNET** — Philips Color Kinetics' proprietary protocol for their PDS supplies/fixtures; common
  in architectural installs using CK gear, otherwise legacy.
- **OPC (Open Pixel Control)** — the dead-simple FadeCandy-era protocol: a 4-byte header + RGB. No
  colour semantics, no compression. (LX fixtures default to its port, 7890.)
- **DDP (Distributed Display Protocol)** — the modern pixel-streaming lingua franca, authored by
  **Mark Lottor / 3waylabs** (of Cubatron LED-art fame). A 32-bit data offset lets you address into
  a large framebuffer, which is why **WLED** and **FPP/Falcon** all speak it. If you want interop,
  this is the one. voxeled implements it (`senders/ddp.mjs`).

## dan-mx — the opinionated dialect

[dan-mx](https://github.com/dnewcome/dan-mx) is the same pixel-streaming idea as DDP, redesigned with
things the standards leave out. voxeled emits it **byte-compatibly** with the dan-mx Python + ESP32
receivers (verified by cross-decoding voxeled's frames through the reference `StreamDecoder`):

- **In-band colour semantics** — the 14-byte header carries an explicit `color_space` (RGB888 /
  RGB565 / G6R5B5 / RGB888-linear) *and* a `transfer` function (linear / gamma-2.2 / sRGB). No other
  pixel protocol names the transfer function, so voxeled — which mixes in **linear RGB** — can carry
  that linear intent to the wire instead of losing it to the controller's hidden gamma.
- **Compression** — an `encoding` field: **RLE** (whole-pixel run-length) and **DELTA** (XOR against
  the previous frame, then RLE'd, so unchanged pixels collapse to zero-runs), with a **keyframe**
  every N frames to recover from UDP loss. `dispatch.mjs` keeps a stateful `DanmxStream` per fixture
  so DELTA works across frames.

The trade-off is **interop**: dan-mx speaks only to its own receivers. Use DDP where interop matters;
use dan-mx to experiment with colour/bandwidth on your own nodes. voxeled emitting both is the proof
of its "own the patch, mix protocols" claim.

### Patching it (opt-in per instance)

```yaml
instances:
  - { fixture: strip, name: wled,  output: { protocol: ddp,   host: 10.0.0.6, offset: 0 } }
  - { fixture: strip, name: panel, output: { protocol: artnet, host: 10.0.0.5, universe: 2, channel: 1, byteOrder: grb } }
  - { fixture: strip, name: mine,  output: { protocol: danmx, host: 10.0.0.7,
        encoding: delta, colorSpace: rgb888, transfer: srgb, keyframeInterval: 30 } }
```

dan-mx defaults to `encoding: raw` (byte-for-byte identical to before); set `auto` (smallest of
RAW/RLE/DELTA per frame), `rle`, or `delta` to opt into compression. `colorSpace`/`transfer` default
to `rgb888`/`linear`.
