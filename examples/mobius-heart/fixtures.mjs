// Fixture-type registry: how a layout's `type:` becomes geometry. Shared by run.mjs (server)
// and export.mjs. Add new fixture types here — each is a (params) => { pixels, meta } function.
import { sampleHeart } from "./heart.mjs";

export const FIXTURES = { "mobius-heart": (params) => sampleHeart(params) };
