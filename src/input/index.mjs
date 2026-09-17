// Inputs — every external stream that can drive the piece, created from the layout's `inputs:`
// and merged by `merge:` (src/input/sources.mjs). Protocols: artnet, sacn (universes → pixels via
// an input map), ddp, tcp (whole frames in scene order), ws (the bus: a page pushes raw RGB frames
// or Art-Net packets as binary messages, and JSON control as text). All of them are just sources;
// the hub composes them over the internal show every tick.
import { createArtNetInput, eachArtNet, OP_DMX } from "./artnet.mjs";
import { createSacnInput } from "./sacn.mjs";
import { createDDPInput } from "./ddp.mjs";
import { createColorInput } from "./color-tcp.mjs";
import { buildInputMap } from "./map.mjs";
import { createSources } from "./sources.mjs";

export function createInputs({ specs = [], merge = {}, scene, bus = null, onControl = null } = {}) {
  const N = scene.count ?? scene.pixels.length;
  const sources = createSources({ N, ...merge });
  const handles = [], list = [];
  let wsSpec = null, wsMap = null, wsSource = null;
  for (const spec of specs) {
    const src = sources.add(spec.name, { priority: spec.priority, timeoutMs: spec.timeoutMs });
    const entry = { ...spec, covered: N };
    if (spec.protocol === "artnet" || spec.protocol === "sacn") {
      const map = buildInputMap(spec.map, N);
      entry.covered = map.covered; entry.universes = map.universes.length;
      const onDmx = (u, data) => src.writeUniverse(map, u, data);
      const h = spec.protocol === "artnet"
        ? createArtNetInput({ port: spec.port, host: spec.host, onDmx, name: scene.name })
        : createSacnInput({ port: spec.port, host: spec.host, universes: spec.universes || map.universes, onDmx });
      h.sock.on("error", (e) => console.error(e.code === "EADDRINUSE" ? `✗ input ${spec.name}: udp port ${spec.port} is already in use` : `✗ input ${spec.name}: ${e.message}`));
      handles.push(h); entry.stats = h.stats;
    } else if (spec.protocol === "ddp") {
      const h = createDDPInput({ port: spec.port, host: spec.host, pixelCount: N, name: scene.name, onFrame: (rgb) => src.writeFrame(rgb) });
      h.sock.on("error", (e) => console.error(`✗ input ${spec.name}: ${e.code === "EADDRINUSE" ? `udp port ${spec.port} is already in use` : e.message}`));
      handles.push(h); entry.stats = h.stats;
    } else if (spec.protocol === "tcp") {
      handles.push(createColorInput({ port: spec.port, host: spec.host, onFrame: (rgb) => src.writeFrame(rgb) }));
    } else if (spec.protocol === "ws") {
      if (wsSpec) throw new Error("only one `ws` input (the bus) per layout");
      wsSpec = spec; wsSource = src; wsMap = buildInputMap(spec.map, N);
    }
    list.push(entry);
  }

  // The bus as an input: binary = a frame (raw RGB in scene order) or Art-Net packets; text = JSON.
  function onMessage({ socket, binary, text }) {
    if (binary) {
      if (!wsSource) return;
      if (binary.length >= 12 && binary.subarray(0, 8).toString("latin1") === "Art-Net\0") { for (const p of eachArtNet(binary)) if (p.op === OP_DMX) wsSource.writeUniverse(wsMap, p.universe, p.data); }
      else wsSource.writeFrame(binary);
      return;
    }
    if (text) {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "control") { onControl?.(msg, (reply) => bus?.sendText(socket, reply)); return; }
      // anything else (pedestal buttons, game state…) is relayed to every other client — the bus is the room
      const out = JSON.stringify({ ...msg, relay: true });
      if (bus) for (const c of bus.clients) if (c !== socket && c.writable) bus.sendText(c, out);
    }
  }

  return {
    sources, list, onMessage, wsInput: !!wsSpec,
    status() { return { mode: sources.mode, fallback: sources.fallback, inputs: list.map((e, i) => ({ name: e.name, protocol: e.protocol, port: e.port, priority: e.priority, covered: e.covered, universes: e.universes, ...sources.status()[i] })) }; },
    close() { for (const h of handles) h.close(); },
  };
}
