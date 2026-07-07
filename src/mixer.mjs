// Mixer / show — crossfade between scenes.
//
// A "scene" is a look: a name + a render function (a pattern with its params bound). The show
// runs two scenes as A/B decks and dissolves between them by a fader x∈[0,1]. In AUTO mode it
// cycles through all scenes on a timeline (hold, then crossfade to the next); a `control` object
// lets a UI override into MANUAL mode and drive the fader directly.
import { lerp } from "./vec.mjs";

const smoothstep = (x) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};

// scenes: [{ name, render(px,t,ctx)->[r,g,b] }]
// control (optional, shared/mutable): { mode:'auto'|'manual', fader, a, b }
export function createShow({ scenes, holdS = 4, fadeS = 2.5, control = null }) {
  const S = scenes.length;

  // Decide which two scenes and how much blend, at time t. Deterministic in AUTO (stable within
  // a frame because all pixels share one t); read from `control` in MANUAL.
  function resolve(t) {
    if (control?.mode === "manual") {
      return { a: ((control.a % S) + S) % S, b: ((control.b % S) + S) % S, x: Math.max(0, Math.min(1, control.fader)) };
    }
    if (S < 2) return { a: 0, b: 0, x: 0 };
    const cycle = holdS + fadeS;
    const k = Math.floor(t / cycle);
    const tt = t - k * cycle;
    const a = k % S, b = (k + 1) % S;
    const x = tt < holdS ? 0 : smoothstep((tt - holdS) / fadeS);
    return { a, b, x };
  }

  // The combined shade function the hub renders.
  function shade(px, t, ctx) {
    const { a, b, x } = resolve(t);
    const ca = scenes[a].render(px, t, ctx);
    if (x <= 0) return ca;
    const cb = scenes[b].render(px, t, ctx);
    if (x >= 1) return cb;
    return [lerp(ca[0], cb[0], x), lerp(ca[1], cb[1], x), lerp(ca[2], cb[2], x)];
  }

  return { shade, resolve, scenes, names: scenes.map((s) => s.name) };
}
