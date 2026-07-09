// dan-mx RLE / DELTA / color-space encoding — must round-trip and stay byte-compatible with the
// dan-mx Python + ESP32 receivers (danmx/{rle,codec,stream}.py, esp32/lib/danmx). We encode with
// DanmxStream and decode with DanmxStreamDecoder (the same algorithm the receivers run).
import {
  DanmxStream, DanmxStreamDecoder, decodeDanmxFrame,
  rleEncode, rleDecode, packColor, unpackColor,
  ENC_RAW, ENC_RLE, ENC_DELTA, CS_RGB888, CS_RGB565, TF_SRGB,
} from "../src/senders/danmx.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// ── RLE primitive (whole-pixel [count][pixel], count 0 = 256) ──────────────────
const solid = Buffer.alloc(300 * 3, 7); // 300 identical pixels
const rle = rleEncode(solid, 3);
// two runs of [count][pixel]: 256 (wraps to 0) then 44 → 2 × (1 + 3) = 8 bytes
ok(rle.length === 8 && rle[0] === 0 && rle[4] === 44, "RLE collapses 300 identical px to 2 runs (256→0, then 44)");
ok(eq(rleDecode(rle, 3, 300), solid), "RLE round-trips");
const noisy = Buffer.from(Array.from({ length: 30 }, (_, i) => i)); // 10 distinct px, all different
ok(rleEncode(noisy, 3).length === 10 * 4, "RLE of all-distinct pixels is 4B/px (no gain)");
ok(eq(rleDecode(rleEncode(noisy, 3), 3, 10), noisy), "RLE round-trips distinct pixels");

// ── a full stream: RAW / RLE / DELTA chosen per frame, decoded back exactly ────
const enc = new DanmxStream({ encoding: "auto", keyframeInterval: 30 });
const dec = new DanmxStreamDecoder();

// frame 1: mostly-solid → RLE beats RAW; first frame has no ref so no DELTA
const f1raw = Buffer.concat([Buffer.alloc(400 * 3, 9), Buffer.from([1, 2, 3])]); // 400 same + 1 different = 401 px
let frames1 = enc.frames(f1raw, 1);
ok(decodeDanmxFrame(frames1[0]).encoding === ENC_RLE, "solid frame → RLE (smaller than RAW)");
ok(eq(dec.decode(frames1[0]).payload, f1raw), "RLE frame decodes to the original pixels");

// frame 2: identical to frame 1 → DELTA is all-zero → collapses to a tiny run
const frames2 = enc.frames(f1raw, 2);
ok(decodeDanmxFrame(frames2[0]).encoding === ENC_DELTA, "unchanged frame → DELTA");
ok(frames2[0].length < 30, "DELTA of an unchanged 401px frame is a tiny datagram (all-zero runs collapse)");
ok(eq(dec.decode(frames2[0]).payload, f1raw), "DELTA reconstructs the full frame (XOR vs reference)");

// frame 3: one pixel changes → DELTA carries essentially one pixel's worth
const f3 = Buffer.from(f1raw); f3[3] = 200; f3[4] = 201; f3[5] = 202;
ok(eq(dec.decode(enc.frames(f3, 3)[0]).payload, f3), "single-pixel change round-trips via DELTA");

// ── keyframe recovery: a decoder that joins mid-stream drops DELTA until a keyframe ──
// use a spatially-noisy but temporally-static frame, so DELTA strictly beats RLE (a solid frame
// would let RLE tie DELTA, and RLE — being stateless — wins the tie, exactly as in stream.py)
const noise = Buffer.from(Array.from({ length: 10 * 3 }, (_, i) => (i * 37 + 11) & 0xff));
const enc2 = new DanmxStream({ encoding: "delta", keyframeInterval: 2 });
const latecomer = new DanmxStreamDecoder();
enc2.frames(noise, 1); // A: keyframe (RAW) — latecomer misses it
const b = enc2.frames(noise, 2)[0]; // B: DELTA (unchanged, but RLE of noise is big)
ok(decodeDanmxFrame(b).encoding === ENC_DELTA && latecomer.decode(b) === null, "DELTA with no reference → decoder returns null (await keyframe)");
enc2.frames(noise, 3); // C: DELTA (since → interval)
const kf = enc2.frames(noise, 4)[0]; // D: keyframe forced (since ≥ keyframeInterval)
ok(decodeDanmxFrame(kf).encoding !== ENC_DELTA && latecomer.decode(kf) !== null, "keyframe is forced after keyframeInterval, recovering the latecomer");

// ── MTU chunking: a wide strip splits into datagrams with rising start_pixel ────
const wide = Buffer.alloc(1000 * 3, 3);
const wf = new DanmxStream({ encoding: "raw" }).frames(wide, 1);
ok(wf.length === 3, `1000 px RAW → 3 datagrams (486+486+28) (got ${wf.length})`);
ok(wf.every((d) => d.length <= 1472), "every datagram fits the MTU");
ok(decodeDanmxFrame(wf[1]).startPixel === 486, "second datagram starts at pixel 486");

// ── color-space packing (RGB565) is 2 bytes/px and unpacks approximately ───────
const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
const packed = packColor(rgb, CS_RGB565);
ok(packed.length === 3 * 2, "RGB565 packs to 2 bytes/pixel");
const back = unpackColor(packed, 3, CS_RGB565);
ok(back[0] > 240 && back[4] > 240 && back[8] > 240, "RGB565 round-trips primaries within tolerance");
const h565 = decodeDanmxFrame(new DanmxStream({ colorSpace: CS_RGB565, transfer: TF_SRGB }).frames(rgb, 1)[0]);
ok(h565.colorSpace === CS_RGB565 && h565.transfer === TF_SRGB && h565.pixelCount === 3, "frame header carries color_space + transfer (RGB565 / sRGB)");

console.log(`\n${fail === 0 ? "✅" : "❌"} danmx-codec: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
