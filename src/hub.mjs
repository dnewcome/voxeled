// The hub — voxeled's spine. Holds the scene, runs one shade function (a single pattern, or a
// mixer/show that crossfades scenes), and fans IDENTICAL frames to every consumer: the WebGL bus
// and each protocol sender. Preview == output because they are literally the same bytes.
import { sub, matVec, eulerMatrix, transpose3 } from "./vec.mjs";

export function createHub({ scene, shade, pattern, fps = 30, bus = null, senders = [] } = {}) {
  const render = shade ?? pattern; // `shade` is the general name; `pattern` kept for one-pattern use
  const N = scene.pixels.length;
  const rgb = new Uint8Array(N * 3); // the normalized frame: flat RGB, 0..255
  let timer = null, t0 = 0, frames = 0;
  const to255 = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

  // Per-instance inverse transforms, so fixture-space patterns can re-base a world pixel back into
  // its instance's local frame: local(px) = Rᵀ · (p_world − instance_pos).
  const inst = (scene.meta?.instances || []).map((it) => ({
    pos: it.pos || [0, 0, 0],
    rotInv: transpose3(eulerMatrix(it.rotDeg || [0, 0, 0])),
  }));
  const local = (px) => {
    const it = inst[px.inst || 0];
    return it ? matVec(it.rotInv, sub(px.p, it.pos)) : px.p;
  };

  const ctx = { scene, instances: inst, local, t: 0, frame: 0 };

  function renderFrame(t) {
    ctx.t = t;
    ctx.frame = frames;
    for (let k = 0; k < N; k++) {
      const c = render(scene.pixels[k], t, ctx);
      rgb[k * 3] = to255(c[0]);
      rgb[k * 3 + 1] = to255(c[1]);
      rgb[k * 3 + 2] = to255(c[2]);
    }
    bus?.broadcast(rgb);
    for (const s of senders) s.send(rgb);
    frames++;
  }

  return {
    frame: rgb,
    ctx,
    renderOnce: () => renderFrame(0),
    start() {
      t0 = Date.now();
      timer = setInterval(() => renderFrame((Date.now() - t0) / 1000), 1000 / fps);
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    get frames() { return frames; },
  };
}
