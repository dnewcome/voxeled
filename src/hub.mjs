// The hub — voxeled's spine. Holds the scene, runs one spatial pattern, and fans IDENTICAL
// frames to every consumer: the WebGL bus and each protocol sender. Preview == output because
// they are literally the same bytes.
export function createHub({ scene, pattern, fps = 30, bus = null, senders = [] } = {}) {
  const N = scene.pixels.length;
  const rgb = new Uint8Array(N * 3); // the normalized frame: flat RGB, 0..255
  let timer = null, t0 = 0, frames = 0;
  const to255 = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

  function render(t) {
    const ctx = { t, scene, frame: frames };
    for (let k = 0; k < N; k++) {
      const c = pattern(scene.pixels[k], t, ctx);
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
    renderOnce: () => render(0),
    start() {
      t0 = Date.now();
      timer = setInterval(() => render((Date.now() - t0) / 1000), 1000 / fps);
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    get frames() { return frames; },
  };
}
