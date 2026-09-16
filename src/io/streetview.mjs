// Street View as a vantage: fetch six compass-aligned faces (n/e/s/w/u/d, fov 90°) through the
// OFFICIAL Street View Static API — the sanctioned way to get imagery; the full panorama tiles are
// not offered. Six 640×640 faces make a cubemap the viewer wraps around the camera. Needs a Maps
// API key (GOOGLE_MAPS_API_KEY); the metadata call is free and returns the pano's true position,
// which is what the vantage should use (the car wasn't standing exactly where you clicked).
// Note Google's terms on caching/storing imagery — treat the files as a working preview, not an asset.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = "https://maps.googleapis.com/maps/api/streetview";
export const FACES = { n: [0, 0], e: [90, 0], s: [180, 0], w: [270, 0], u: [0, 90], d: [0, -90] }; // heading, pitch

export function streetviewUrls({ lat, lon, pano, size = 640, key, source = "outdoor" }) {
  const loc = pano ? `pano=${encodeURIComponent(pano)}` : `location=${lat},${lon}`;
  const meta = `${BASE}/metadata?${loc}&source=${source}&key=${key}`;
  const faces = Object.fromEntries(Object.entries(FACES).map(([f, [heading, pitch]]) =>
    [f, `${BASE}?size=${size}x${size}&${loc}&heading=${heading}&pitch=${pitch}&fov=90&source=${source}&key=${key}`]));
  return { meta, faces };
}

export async function fetchStreetView({ lat, lon, pano, size = 640, key, outDir, fetchImpl = fetch }) {
  if (!key) throw new Error("no API key — set GOOGLE_MAPS_API_KEY (Street View Static API enabled)");
  const first = streetviewUrls({ lat, lon, pano, size, key });
  const meta = await (await fetchImpl(first.meta)).json();
  if (meta.status !== "OK") throw new Error(`Street View: ${meta.status}${meta.error_message ? " — " + meta.error_message : ""} (no imagery there?)`);
  // Re-request by pano id so all six faces come from the SAME panorama.
  const { faces } = streetviewUrls({ pano: meta.pano_id, size, key });
  mkdirSync(outDir, { recursive: true });
  for (const [f, url] of Object.entries(faces)) {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`face ${f}: HTTP ${r.status}`);
    writeFileSync(path.join(outDir, `${f}.jpg`), Buffer.from(await r.arrayBuffer()));
  }
  const info = { panoId: meta.pano_id, lat: meta.location.lat, lon: meta.location.lng, date: meta.date, copyright: meta.copyright, size, fetched: new Date().toISOString() };
  writeFileSync(path.join(outDir, "vantage.json"), JSON.stringify(info, null, 2) + "\n");
  return info;
}
